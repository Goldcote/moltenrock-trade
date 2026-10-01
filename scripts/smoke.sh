#!/usr/bin/env bash
# End-to-end smoke test against a LOCAL dev server with a FRESH database:
#   npm run db:reset:local && npm run dev      (in another terminal)
#   bash scripts/smoke.sh
# Exercises the human flow (merchant, partner, orders, QR-bill invoice), the agent flow over MCP,
# and the security guarantees. Uses the read-only WooCommerce key from .dev.vars if present (GET only).
set -uo pipefail
B=${BASE:-http://localhost:8787}
W=$(mktemp -d)
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
ko() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }
post() { curl -s -H "Origin: $B" "$@"; }
last_link() { curl -s "$B/dev/mail" | grep -oE "$B/auth/verify\?t=[A-Za-z0-9_-]+" | head -1; }
# Local http gets a plain (non-Secure) session cookie, because Safari drops Secure cookies on http://localhost.
has_session() { awk -F'\t' '$6=="mt_session" && $4=="FALSE" {f=1} END {exit !f}' "$1"; }
csrf_of() { grep -oE 'name="_csrf" value="[^"]+"' "$1" | head -1 | sed -E 's/.*value="([^"]+)"/\1/'; }
mcp() { curl -s -X POST "$B/mcp" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$2"; }
tool() { mcp "$1" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}"; }
py() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
res() { py "json.dumps(d['result']['structuredContent'])"; }

echo "== Fresh database: the app sets itself up (tables + secrets) on first request =="
check "landing redirects to sign-up on an empty install" "[ \"\$(curl -s -o /dev/null -w '%{redirect_url}' $B/)\" = '$B/merchant/signup' ]"

echo "== Merchant sign-up (human-only identity; IBAN can follow later) → signed in immediately =="
loc=$(post -c "$W/owner.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/merchant/signup" --data-urlencode "legal_name=Alpenrose Handels AG" --data-urlencode "street=Musterstrasse" -d house_no=1 -d postcode=8001 \
  --data-urlencode "city=Zürich" -d email=owner@example.test --data-urlencode "uid=CHE-123.456.788" -d vat_registered=1 -d default_lang=de)
check "owner signed in straight after sign-up, lands on setup (no email; Safari-safe local cookie)" "[ '$loc' = '$B/merchant/setup' ] && has_session '$W/owner.jar'"
post -o /dev/null -X POST "$B/login" -d email=owner@example.test
T=$(last_link); T=${T#*t=}
post -c "$W/owner2.jar" -o /dev/null -X POST "$B/auth/verify" -d "t=$T"
check "magic-link sign-in works" "has_session '$W/owner2.jar'"
code=$(post -o "$W/r.html" -w '%{http_code}' -X POST "$B/auth/verify" -d "t=$T")
check "magic link is single-use (replay refused)" "grep -q 'abgelaufen' '$W/r.html'"

echo "== Owner creates agent access =="
curl -s -b "$W/owner.jar" -o "$W/m.html" "$B/merchant/setup"; C=$(csrf_of "$W/m.html")
post -b "$W/owner.jar" -o "$W/tok.html" -X POST "$B/merchant/tokens" -d "_csrf=$C" -d name=Claude -d scope=configure
AT=$(grep -oE 'mt_[A-Za-z0-9_-]{30,}' "$W/tok.html" | head -1)
check "configure token shown once" "[ -n '$AT' ]"
post -b "$W/owner.jar" -o "$W/tok2.html" -X POST "$B/merchant/tokens" -d "_csrf=$C" -d name=Reader -d scope=read
RT=$(grep -oE 'mt_[A-Za-z0-9_-]{30,}' "$W/tok2.html" | head -1)

echo "== Agent over MCP =="
init=$(mcp "$AT" '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}')
check "initialize" "echo '$init' | grep -q '\"serverInfo\"'"
n=$(mcp "$AT" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | py "len(d['result']['tools'])")
check "tools/list for configure token ($n tools)" "[ $n -ge 25 ]"
nr=$(mcp "$RT" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | py "len(d['result']['tools'])")
check "read token sees only read tools ($nr)" "[ $nr -lt $n ]"
step=$(tool "$AT" get_setup_status '{}' | py "d['result']['structuredContent']['next_action']['step']")
check "setup starts at connect_shop (got $step)" "[ '$step' = 'connect_shop' ]"
e=$(tool "$RT" invite_partner '{"company":"X","contact_name":"Y","email":"x@example.test","street":"a","postcode":"8001","city":"Zürich"}' | py "d['result']['structuredContent']['error']['code']")
check "read token cannot invite (INSUFFICIENT_SCOPE)" "[ '$e' = 'INSUFFICIENT_SCOPE' ]"
e=$(tool "$AT" update_settings '{"iban":"CH44 3199 9123 0008 8901 2"}' | py "d['result']['structuredContent']['error']['code']")
check "agent cannot touch bank details (HUMAN_ONLY)" "[ '$e' = 'HUMAN_ONLY' ]"
bk=$(tool "$AT" get_setup_status '{}' | py "[s['done'] for s in d['result']['structuredContent']['steps'] if s['id']=='bank_account'][0]")
check "without an IBAN the bank step is open (the shop takes no orders yet)" "[ '$bk' = False ]"
curl -s -b "$W/owner.jar" -o "$W/b0.html" "$B/merchant/setup"; BC=$(csrf_of "$W/b0.html")
check "Setup asks for the IBAN" "grep -q 'class=\"iban-missing\"' '$W/b0.html'"
post -b "$W/owner.jar" -o "$W/bad.html" -X POST "$B/merchant/business" -d "_csrf=$BC" --data-urlencode "legal_name=Alpenrose Handels AG" --data-urlencode "street=Musterstrasse" -d house_no=1 -d postcode=8001 --data-urlencode "city=Zürich" -d email=owner@example.test --data-urlencode "uid=CHE-123.456.788" -d vat_registered=1 --data-urlencode "iban=DE89 3704 0044 0532 0130 00"
check "a non-Swiss IBAN is refused with a clear message" "grep -q 'Liechtensteiner' '$W/bad.html'"
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/business" -d "_csrf=$BC" --data-urlencode "legal_name=Alpenrose Handels AG" --data-urlencode "street=Musterstrasse" -d house_no=1 -d postcode=8001 --data-urlencode "city=Zürich" -d email=owner@example.test --data-urlencode "uid=CHE-123.456.788" -d vat_registered=1 --data-urlencode "iban=CH93-0076-2011-6238-5295-7"
bk=$(tool "$AT" get_setup_status '{}' | py "[s['done'] for s in d['result']['structuredContent']['steps'] if s['id']=='bank_account'][0]")
check "the owner adds the IBAN later (dashes are fine)" "[ '$bk' = True ]"
post -b "$W/owner.jar" -o "$W/sl.html" -X POST "$B/merchant/signin-link" -d "_csrf=$BC"
SL=$(grep -oE "$B/auth/verify\?t=[A-Za-z0-9_-]+" "$W/sl.html" | head -1)
post -c "$W/owner3.jar" -o /dev/null -X POST "$B/auth/verify" -d "t=${SL#*t=}"
check "sign-in link for another browser works without email" "[ -n '$SL' ] && has_session '$W/owner3.jar'"
xk=$(curl -s -X POST "$B/mcp" -H "X-API-Key: $AT" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | py "len(d['result']['tools'])")
check "agents can send their key as X-API-Key ($xk tools)" "[ '$xk' -ge 25 ]"

if [ -f .dev.vars ] && grep -q '^WOO_CONSUMER_KEY=.' .dev.vars; then
  set -a; . ./.dev.vars; set +a
  args=$(python3 -c "import json,os; print(json.dumps({'kind':'woocommerce','base_url':os.environ['WOO_URL'],'consumer_key':os.environ['WOO_CONSUMER_KEY'],'consumer_secret':os.environ['WOO_CONSUMER_SECRET'],'prices_include_tax':True}))")
  r=$(tool "$AT" connect_shop "$args" | py "d['result']['isError']")
  check "connect_shop with the READ-ONLY key" "[ '$r' = 'False' ]"
  imp=$(tool "$AT" import_catalog '{}' | res)
  echo "     import: $(echo "$imp" | py "f\"{d.get('total')} items, languages {d.get('languages')}, {d.get('translation_groups')} translation groups, {d.get('flagged')} flagged\"")"
  check "catalogue imported" "[ \"\$(echo '$imp' | py \"d.get('total',0)\")\" -gt 0 ]"
else
  echo "  (no .dev.vars WOO key — skipping live import)"
fi
PID=$(tool "$AT" list_products '{"filter":"orderable","limit":1}' | py "d['result']['structuredContent']['items'][0]['id']")
miss=$(tool "$AT" list_missing_translations '{}' | py "len(d['result']['structuredContent']['items'])")
echo "     products missing a language: $miss"
tool "$AT" set_product_translation "{\"product_id\":$PID,\"lang\":\"fr\",\"name\":\"Article de démonstration (agent)\",\"short_desc\":\"Texte écrit par l'agent.\"}" >/dev/null
prov=$(tool "$AT" get_product "{\"product_id\":$PID}" | py "d['result']['structuredContent']['translations']['fr']['provenance']")
check "agent translation recorded with provenance 'agent'" "[ '$prov' = 'agent' ]"
tool "$AT" update_settings '{"cancel_window_minutes":0,"fulfilment_profile":"woocommerce-order","woo_handoff":{"meta":[{"key":"order_channel","value":"trade"}]}}' >/dev/null
rsv=$(tool "$AT" update_settings '{"woo_handoff":{"meta":[{"key":"_moltentrade_ref","value":"x"}]}}' | py "d['result'].get('isError')")
check "agent cannot overwrite the reserved _moltentrade_ order meta" "[ '$rsv' = True ]"
# Order with the most expensive orderable item; quantities derived from its real Standard-tier net price.
read PX UNIT <<<"$(tool "$AT" list_products '{"filter":"orderable","limit":200}' | py "' '.join(map(str, max(((p['id'], p['price_rappen']*6000//(10000+810) if p['prices_include_tax'] else p['price_rappen']*6000//10000) for p in d['result']['structuredContent']['items']), key=lambda x: x[1])))")"
QMIN=$(( 20000 / UNIT + 2 )); echo "     ordering product #$PX at ~$UNIT rappen net → $QMIN units clears CHF 200"
tool "$AT" confirm_defaults '{}' >/dev/null

echo "== Partner (invited by the agent → approved on Standard) =="
invr=$(tool "$AT" invite_partner '{"company":"Hôtel Beau-Séjour SA","contact_name":"Élodie Müller","email":"buyer@example.test","street":"Rue du Lac","house_no":"5","postcode":"1003","city":"Lausanne","language":"fr","business_type":"hotel"}')
delivered=$(echo "$invr" | py "d['result']['structuredContent']['invite_email_delivered']")
check "invite reports that no email was delivered (no provider locally)" "[ '$delivered' = False ]"
T=$(last_link); T=${T#*t=}
post -c "$W/p.jar" -o /dev/null -X POST "$B/auth/verify" -d "t=$T"
acc=$(curl -s -b "$W/p.jar" -o /dev/null -w '%{redirect_url}' "$B/catalog")
check "invited customer accepts the terms before the first order" "echo '$acc' | grep -q '/legal/accept?next=%2Fcatalog'"
curl -s -b "$W/p.jar" -o "$W/acc.html" "$B/legal/accept?next=%2Fcatalog"; AC=$(csrf_of "$W/acc.html")
check "acceptance page links the terms and the privacy notice" "grep -q 'href=\"/legal/terms\"' '$W/acc.html' && grep -q 'href=\"/legal/privacy\"' '$W/acc.html'"
post -b "$W/p.jar" -o /dev/null -X POST "$B/legal/accept?next=%2Fcatalog" -d "_csrf=$AC" -d terms=1
curl -s -b "$W/p.jar" -D "$W/cat.h" -o "$W/cat.html" "$B/catalog"
check "partner sees the catalogue" "grep -q 'class=\"price\"' '$W/cat.html'"
check "catalogue in the partner's language (FR agent text shown)" "grep -q 'Article de démonstration (agent)' '$W/cat.html'"
check "priced page is no-store" "grep -qi 'cache-control: private, no-store' '$W/cat.h'"
check "CSP header present" "grep -qi 'content-security-policy' '$W/cat.h'"
PC=$(csrf_of "$W/cat.html")
code=$(post -b "$W/p.jar" -o /dev/null -w '%{http_code}' -X POST "$B/cart/add" -d product_id=$PX -d qty=1)
check "cart write without CSRF token refused ($code)" "[ $code = 403 ]"
code=$(curl -s -H "Origin: https://evil.example" -b "$W/p.jar" -o /dev/null -w '%{http_code}' -X POST "$B/cart/add" -d "_csrf=$PC" -d product_id=$PX -d qty=1)
check "cross-origin POST refused ($code)" "[ $code = 403 ]"
post -b "$W/p.jar" -o /dev/null -X POST "$B/cart/add" -d "_csrf=$PC" -d product_id=$PX -d qty=1
post -b "$W/p.jar" -o "$W/min.html" -X POST "$B/checkout" -d "_csrf=$PC" -d ship_mode=delivery
check "below minimum order refused" "grep -q 'minimal' '$W/min.html'"
post -b "$W/p.jar" -o /dev/null -X POST "$B/cart/add" -d "_csrf=$PC" -d product_id=$PX -d qty=$QMIN
loc=$(post -b "$W/p.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/checkout" -d "_csrf=$PC" -d ship_mode=delivery -d po_number=PO-4711)
REF=$(echo "$loc" | grep -oE 'MT-[A-Z0-9]+')
check "order placed ($REF)" "[ -n '$REF' ]"
sleep 1; curl -s -b "$W/p.jar" -o /dev/null "$B/orders/$REF"
ord=$(tool "$AT" get_order "{\"ref\":\"$REF\"}" | res)
check "order confirmed after the cancel window" "[ \"\$(echo '$ord' | py \"d['state']\")\" = confirmed ]"
INV=$(echo "$ord" | py "d['invoices'][0]['id']")
curl -s -b "$W/p.jar" -o "$W/inv.pdf" "$B/invoices/$INV.pdf"
check "partner downloads the QR-bill invoice PDF" "head -c 5 '$W/inv.pdf' | grep -q '%PDF-'"
curl -s -b "$W/p.jar" -o "$W/inv.html" "$B/invoices/$INV"
check "free-plan invoice page: print-ready QR-bill with SVG QR code (FR)" "grep -q 'class=\"qr\"' '$W/inv.html' && grep -q 'Section paiement' '$W/inv.html'"
code=$(curl -s -o /dev/null -w '%{http_code}' "$B/invoices/$INV.pdf")
check "invoice not reachable without login ($code)" "[ $code = 404 ]"
read HST HPM HMETA <<<"$(tool "$AT" get_shop_overview '{}' | py "(lambda b: ' '.join([b['status'], b['payment_method'], ','.join(m['key']+'='+m['value'] for m in b['meta_data'])]))(d['result']['structuredContent']['latest_fulfilment_handoff']['payload']['body'])")"
check "WooCommerce hand-off built as DRY RUN from settings ($HST, $HPM, $HMETA)" "[ '$HST' = processing ] && [ '$HPM' = bacs ] && echo '$HMETA' | grep -q 'order_channel=trade' && echo '$HMETA' | grep -q '_moltentrade_ref=MT-'"

echo "== No email provider: invite flagged, owner creates a sign-in link to forward =="
curl -s -b "$W/owner.jar" -o "$W/ap0.html" "$B/merchant/approvals"; OC0=$(csrf_of "$W/ap0.html")
post -b "$W/owner.jar" -o "$W/pl.html" -X POST "$B/merchant/partners/1/link" -d "_csrf=$OC0"
PL=$(grep -oE "$B/auth/verify\?t=[A-Za-z0-9_-]+" "$W/pl.html" | head -1)
check "owner-made partner sign-in link shown once" "[ -n '$PL' ]"
post -c "$W/p2.jar" -o /dev/null -X POST "$B/auth/verify" -d "t=${PL#*t=}"
check "partner signs in with the forwarded link" "has_session '$W/p2.jar'"

echo "== Held basket: agent lowers the threshold to CHF 500, proposes; human confirms =="
tool "$AT" update_settings '{"approval_threshold_rappen":50000}' >/dev/null
QBIG=$(( 50000 / UNIT + 2 ))
post -b "$W/p.jar" -o /dev/null -X POST "$B/cart/add" -d "_csrf=$PC" -d product_id=$PX -d qty=$QBIG
loc=$(post -b "$W/p.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/checkout" -d "_csrf=$PC" -d ship_mode=pickup)
REF2=$(echo "$loc" | grep -oE 'MT-[A-Z0-9]+')
o2=$(tool "$AT" get_order "{\"ref\":\"$REF2\"}" | res)
check "big basket waits for approval" "[ \"\$(echo '$o2' | py \"d['state']\")\" = awaiting_approval ]"
OID=$(echo "$o2" | py "d['id']")
e=$(tool "$AT" propose_basket_decision "{\"order_id\":$OID,\"decision\":\"approve\",\"reason\":\"Known hotel customer, usual season volume\",\"idempotency_key\":\"k1\"}" | py "d['result']['structuredContent']['id']")
e2=$(tool "$AT" propose_basket_decision "{\"order_id\":$OID,\"decision\":\"approve\",\"reason\":\"Known hotel customer, usual season volume\",\"idempotency_key\":\"k1\"}" | py "d['result']['structuredContent']['id']")
check "idempotent retry returns the same proposal ($e = $e2)" "[ -n '$e' ] && [ '$e' = '$e2' ]"
curl -s -b "$W/owner.jar" -o "$W/ap.html" "$B/merchant/approvals"; OC=$(csrf_of "$W/ap.html")
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/proposals/$e/decide" -d "_csrf=$OC" -d decision=confirm
st=$(tool "$AT" get_order "{\"ref\":\"$REF2\"}" | py "d['result']['structuredContent']['state']")
check "owner confirmed → order confirmed ($REF2 $st)" "[ -n '$REF2' ] && [ '$st' = confirmed ]"

echo "== Any shop: the agent reads a website, a person confirms the prices =="
U='https://shop.example/products'
up=$(tool "$AT" upsert_products "{\"products\":[{\"source_id\":\"$U/linen-towel\",\"sku\":\"LT-1\",\"source_url\":\"$U/linen-towel\",\"price_rappen\":1890,\"texts\":{\"de\":{\"name\":\"Leinen-Handtuch\"},\"fr\":{\"name\":\"Essuie-mains en lin\"}}},{\"source_id\":\"$U/stoneware-mug\",\"sku\":\"MUG-1\",\"source_url\":\"$U/stoneware-mug\",\"price_rappen\":1450,\"texts\":{\"en\":{\"name\":\"Stoneware mug\"}}},{\"source_id\":\"$U/gift-box\",\"source_url\":\"$U/gift-box\",\"texts\":{\"en\":{\"name\":\"Gift box\"}}}]}" | res)
read UC UW US <<<"$(echo "$up" | py "f\"{d['created']} {d['waiting_for_price_confirmation']} {d['set_aside_without_price']}\"")"
check "agent adds products it read on a website ($UC new, $UW waiting, $US without a price)" "[ '$UC $UW $US' = '3 2 1' ]"
bad=$(tool "$AT" upsert_products '{"products":[{"source_id":"x","source_url":"http://shop.example/x","price_rappen":100,"texts":{"en":{"name":"X"}}}]}' | py "d['result']['isError']")
check "only https source pages accepted" "[ '$bad' = True ]"
read NU LID MID <<<"$(tool "$AT" list_products '{"filter":"unconfirmed","limit":50}' | py "(lambda it: f\"{len(it)} {[p['id'] for p in it if p['sku']=='LT-1'][0]} {[p['id'] for p in it if p['sku']=='MUG-1'][0]}\")(d['result']['structuredContent']['items'])")"
check "list_products filter 'unconfirmed' shows the two priced ones ($NU)" "[ '$NU' = 2 ]"
ord=$(tool "$AT" list_products '{"filter":"orderable","limit":200}' | py "any(p['id'] in ($LID, $MID) for p in d['result']['structuredContent']['items'])")
check "not orderable before a person confirmed the price" "[ '$ord' = False ]"
ca=$(post -b "$W/p.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/cart/add" -d "_csrf=$PC" -d product_id=$LID -d qty=6)
check "trade customer cannot add it to the basket yet" "echo '$ca' | grep -q 'error='"
st=$(tool "$AT" get_setup_status '{}' | py "[s for s in d['result']['structuredContent']['steps'] if s['id']=='confirm_prices'][0]['done']")
check "setup shows prices waiting for the owner" "[ '$st' = False ]"
np=$(mcp "$AT" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | py "[t['name'] for t in d['result']['tools'] if 'confirm_price' in t['name'] or 'decide_price' in t['name']]")
check "there is no agent tool to confirm prices" "[ '$np' = '[]' ]"
curl -s -b "$W/owner.jar" -o "$W/pr.html" "$B/merchant/approvals"; PRC=$(csrf_of "$W/pr.html")
check "Approvals lists the prices with the page they came from" "grep -q 'id=\"prices\"' '$W/pr.html' && grep -q 'Leinen-Handtuch' '$W/pr.html' && grep -q 'shop.example ↗' '$W/pr.html'"
curl -s -b "$W/owner.jar" -o "$W/dq.html" "$B/merchant"
check "dashboard queue counts the prices" "grep -q 'q-ic prices' '$W/dq.html'"
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/prices" -d "_csrf=$PRC" -d id=$LID -d decision=confirm
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/prices" -d "_csrf=$PRC" -d id=$MID -d decision=decline
ord=$(tool "$AT" list_products '{"filter":"orderable","limit":200}' | py "[p['id'] in [x['id'] for x in d['result']['structuredContent']['items']] for p in [{'id':$LID},{'id':$MID}]]")
check "owner confirmed → orderable; declined → not ($ord)" "[ '$ord' = '[True, False]' ]"
ca=$(post -b "$W/p.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/cart/add" -d "_csrf=$PC" -d product_id=$LID -d qty=6)
check "trade customer can order it now" "echo '$ca' | grep -q 'added=$LID'"
tool "$AT" upsert_products "{\"products\":[{\"source_id\":\"$U/linen-towel\",\"source_url\":\"$U/linen-towel\",\"price_rappen\":2090,\"texts\":{\"de\":{\"name\":\"Leinen-Handtuch\"}}},{\"source_id\":\"$U/stoneware-mug\",\"price_rappen\":1450,\"texts\":{\"en\":{\"name\":\"Stoneware mug\"}}}]}" >/dev/null
read LP LPP LOK <<<"$(tool "$AT" get_product "{\"product_id\":$LID}" | py "f\"{d['result']['structuredContent']['price_rappen']} {d['result']['structuredContent']['proposed_price_rappen']} {d['result']['structuredContent']['price_confirmed_at'] is not None}\"")"
check "a changed website price waits; the confirmed price stays in force ($LP → $LPP)" "[ '$LP $LPP $LOK' = '1890 2090 True' ]"
mg=$(tool "$AT" get_product "{\"product_id\":$MID}" | py "f\"{d['result']['structuredContent']['unpriceable']}{d['result']['structuredContent']['included']}\"")
check "a declined product is not brought back by the agent reading it again" "[ '$mg' = 10 ]"
curl -s -b "$W/owner.jar" -o "$W/pr2.html" "$B/merchant/approvals"
check "Approvals shows the change: old → new price, +11%" "grep -q '<s>' '$W/pr2.html' && grep -q '↑ 11%' '$W/pr2.html'"
pc=$(post -b "$W/p.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/merchant/prices" -d "_csrf=$PC" -d all=1 -d decision=confirm)
still=$(tool "$AT" get_product "{\"product_id\":$LID}" | py "d['result']['structuredContent']['proposed_price_rappen']")
check "a trade customer cannot confirm prices" "echo '$pc' | grep -q '/catalog' && [ '$still' = 2090 ]"
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/prices" -d "_csrf=$PRC" -d all=1 -d decision=confirm
read LP LPP <<<"$(tool "$AT" get_product "{\"product_id\":$LID}" | py "f\"{d['result']['structuredContent']['price_rappen']} {d['result']['structuredContent']['proposed_price_rappen']}\"")"
st=$(tool "$AT" get_setup_status '{}' | py "[s for s in d['result']['structuredContent']['steps'] if s['id']=='confirm_prices'][0]['done']")
check "\"Confirm all\" makes the new price live and completes the step ($LP, $st)" "[ '$LP $LPP $st' = '2090 None True' ]"

echo "== Launch essentials: legal pages, email, exports, updates =="
lt=$(curl -s "$B/legal/terms?lang=de")
check "built-in terms filled with the shop's details (DE)" "echo \"\$lt\" | grep -q 'Alpenrose Handels AG' && echo \"\$lt\" | grep -q 'Gerichtsstand ist Zürich'"
check "privacy notice and legal notice served" "curl -s '$B/legal/privacy?lang=en' | grep -q 'Privacy notice' && curl -s '$B/legal/imprint?lang=en' | grep -q 'CHE-123.456.788'"
check "storefront footer links terms, privacy and legal notice" "curl -s '$B/apply' | grep -q 'href=\"/legal/imprint\"'"
check "application form: accept the terms with links" "curl -s '$B/apply?lang=en' | grep -q 'I accept the <a href=\"/legal/terms\"'"
hl=$(tool "$AT" update_settings '{"legal_terms_url":"https://evil.example/terms"}' | py "d['result']['structuredContent']['error']['code']")
check "agents cannot change the legal pages ($hl)" "[ '$hl' = HUMAN_ONLY ]"
curl -s -b "$W/owner.jar" -o "$W/s.html" "$B/merchant/setup"; SC=$(csrf_of "$W/s.html")
check "Setup shows the legal and email step" "grep -q 'id=\"legal\"' '$W/s.html' && grep -q 'id=\"email\"' '$W/s.html'"
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/legal" -d "_csrf=$SC" --data-urlencode "terms_url=https://shop.example/agb" -d privacy_url= -d confirm=1
red=$(curl -s -o /dev/null -w '%{redirect_url}' "$B/legal/terms")
check "the owner's own terms page is used when set ($red)" "[ '$red' = 'https://shop.example/agb' ]"
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/legal" -d "_csrf=$SC" -d terms_url= -d privacy_url= -d confirm=1
lgs=$(tool "$AT" get_setup_status '{}' | py "[s['done'] for s in d['result']['structuredContent']['steps'] if s['id']=='legal'][0]")
check "the owner's confirmation completes the legal step" "[ '$lgs' = True ]"
mt=$(post -b "$W/owner.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/merchant/email-test" -d "_csrf=$SC")
check "test email is honest without a provider; message in the dev mailbox" "echo '$mt' | grep -q 'mail=notsent' && curl -s '$B/dev/mail' | grep -q 'Test-E-Mail'"
ex=$(curl -s -b "$W/owner.jar" -D "$W/ex.h" -o "$W/inv.csv" -w '%{http_code}' "$B/merchant/exports/invoices?period=all")
check "invoices CSV for the accountant (UTF-8 BOM, semicolons, the order's invoice)" "[ $ex = 200 ] && grep -qi 'content-type: text/csv' '$W/ex.h' && head -c 3 '$W/inv.csv' | od -An -tx1 | tr -s ' ' | grep -q 'ef bb bf' && grep -q 'document;type;issue_date' '$W/inv.csv' && grep -q ';MT-' '$W/inv.csv'"
curl -s -b "$W/owner.jar" -o "$W/j.csv" "$B/merchant/exports/journal?period=all"
bal=$(python3 -c "import csv,sys; r=list(csv.reader(open(sys.argv[1],encoding='utf-8-sig'),delimiter=';'))[1:]; rec=sum(round(float(x[5])*100) for x in r if x[3]=='1100'); rev=sum(round(float(x[5])*100) for x in r if x[4]=='3200'); vat=sum(round(float(x[5])*100) for x in r if x[4]=='2200'); print(len(r), rec==rev+vat and rec>0)" "$W/j.csv")
check "bookkeeping journal balances: receivables = revenue + VAT ($bal)" "echo '$bal' | grep -q 'True'"
curl -s -b "$W/owner.jar" -o "$W/b.json" "$B/merchant/exports/backup"
bk=$(python3 -c "import json,sys; s=open(sys.argv[1]).read(); d=json.loads(s); print(d['format'], len(d['tables']['invoices'])>0, not any(x in s for x in ('token_hash','session_secret','consumer_secret','code_hash')))" "$W/b.json")
check "complete backup, without any secrets ($bk)" "[ '$bk' = 'moltenrock-trade.backup.v1 True True' ]"
nb=$(curl -s -o /dev/null -w '%{http_code}' "$B/merchant/exports/invoices")
check "exports need a signed-in owner ($nb)" "[ $nb = 404 ]"
xl=$(tool "$AT" get_export_link '{"file":"invoices","period":"all"}' | py "d['result']['structuredContent']['url']")
check "agent hands out a one-hour download link that works" "curl -s '$xl' | grep -q 'document;type'"
check "a tampered link is refused" "[ \$(curl -s -o /dev/null -w '%{http_code}' '${xl%sig=*}sig=00') = 404 ]"
bl=$(tool "$AT" get_export_link '{"file":"backup"}' | py "d['result'].get('isError')")
check "the complete backup is never available by link" "[ '$bl' = True ]"
us=$(curl -s -b "$W/owner.jar" "$B/status"); VER=$(sed -n "s/.*VERSION = '\(.*\)'.*/\1/p" src/version.ts)
check "Status shows the running version ($VER)" "echo \"\$us\" | grep -q 'MoltenRock Trade $VER' && echo \"\$us\" | grep -q 'id=\"software\"'"
ua=$(tool "$AT" update_settings '{"update_check":false,"accounting_accounts":{"revenue":"3400"}}' | py "str(d['result']['structuredContent']['update_check']) + ' ' + d['result']['structuredContent']['accounting_accounts']['revenue']")
check "agent can switch the update check off and set bookkeeping accounts ($ua)" "[ '$ua' = 'False 3400' ]"
bad=$(tool "$AT" update_settings '{"accounting_accounts":{"bank":"12ab"}}' | py "d['result']['structuredContent']['error']['code']")
check "invalid account numbers refused ($bad)" "[ '$bad' = INVALID_SETTING ]"
tool "$AT" update_settings '{"update_check":true,"accounting_accounts":{"revenue":"3200"}}' >/dev/null

echo "== Owner dashboard =="
curl -s -b "$W/owner.jar" -o "$W/d.html" "$B/merchant"
check "dashboard renders KPIs, revenue chart and live panels" "grep -q 'kpi-card' '$W/d.html' && grep -q 'class=\"chart bars\"' '$W/d.html' && grep -q 'data-poll=\"/merchant/live/feed\"' '$W/d.html'"
check "live feed fragment for the owner" "curl -s -b '$W/owner.jar' '$B/merchant/live/feed' | grep -q 'class=\"feed\"'"
check "live fragments need a session ($(curl -s -o /dev/null -w '%{http_code}' "$B/merchant/live/queue"))" "[ \$(curl -s -o /dev/null -w '%{http_code}' '$B/merchant/live/queue') = 401 ]"
mv=$(tool "$AT" get_moltenview_view '{}' | py "d['result']['structuredContent']['data']['source'] + ' ' + str(len(d['result']['structuredContent']['data']['sections']))")
check "MoltenView view ready to push ($mv sections)" "echo '$mv' | grep -q '^MoltenRock Trade [1-9]'"

echo "== One-address connect (OAuth 2.1 + PKCE, as Claude does it) =="
h=$(curl -s -D - -o /dev/null -X POST "$B/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | tr -d '\r' | grep -i '^www-authenticate')
check "MCP without a key points to the connect metadata" "echo '$h' | grep -q 'resource_metadata=\"$B/.well-known/oauth-protected-resource/mcp\"'"
check "discovery documents" "curl -s '$B/.well-known/oauth-protected-resource/mcp' | grep -q '\"authorization_servers\":\\[\"$B\"' && curl -s '$B/.well-known/oauth-authorization-server' | grep -q '\"code_challenge_methods_supported\":\\[\"S256\"'"
CID=$(curl -s -X POST "$B/oauth/register" -H 'Content-Type: application/json' -d '{"redirect_uris":["http://localhost:33418/callback"],"client_name":"Claude Code"}' | py "d['client_id']")
check "agent app registers itself" "echo '$CID' | grep -q '^mtc_'"
bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/oauth/register" -H 'Content-Type: application/json' -d '{"redirect_uris":["javascript:alert(1)"]}')
check "dangerous return addresses refused at registration ($bad)" "[ $bad = 400 ]"
VER=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))"); CH=$(python3 -c "import hashlib,base64,sys;print(base64.urlsafe_b64encode(hashlib.sha256(sys.argv[1].encode()).digest()).decode().rstrip('='))" "$VER")
Q="response_type=code&client_id=$CID&redirect_uri=http%3A%2F%2Flocalhost%3A33418%2Fcallback&code_challenge=$CH&code_challenge_method=S256&state=st4t3&scope=configure"
nl=$(curl -s -o /dev/null -w '%{redirect_url}' "$B/oauth/authorize?$Q")
check "not signed in → sign in first, then back to the consent page" "echo '$nl' | grep -q '/login?next=%2Foauth%2Fauthorize'"
ev=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -b "$W/owner.jar" "$B/oauth/authorize?response_type=code&client_id=$CID&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&code_challenge=$CH&code_challenge_method=S256")
check "unregistered return address: error page, never a redirect ($ev)" "[ '$ev' = '400 ' ]"
curl -s -b "$W/owner.jar" -D "$W/ch.txt" -o "$W/consent.html" "$B/oauth/authorize?$Q"
check "owner sees the consent page (CSP allows only that return address)" "grep -q 'name=\"scope\"' '$W/consent.html' && grep -qi \"form-action 'self' http://localhost:33418\" '$W/ch.txt'"
CC=$(csrf_of "$W/consent.html")
back=$(post -b "$W/owner.jar" -o /dev/null -w '%{redirect_url}' -X POST "$B/oauth/authorize?$Q" -d "_csrf=$CC" -d decision=allow -d scope=operate)
CODE=$(python3 -c "import sys,urllib.parse as u;q=u.parse_qs(u.urlparse(sys.argv[1]).query);print(q.get('code',[''])[0] if q.get('state')==['st4t3'] else '')" "$back")
check "Allow → back to the app with a code and the same state" "[ -n '$CODE' ]"
wv=$(curl -s -X POST "$B/oauth/token" -d grant_type=authorization_code -d "code=$CODE" -d client_id=$CID -d redirect_uri=http://localhost:33418/callback -d code_verifier=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA | py "d.get('error')")
check "wrong PKCE verifier refused ($wv)" "[ '$wv' = invalid_grant ]"
OT=$(curl -s -X POST "$B/oauth/token" -d grant_type=authorization_code -d "code=$CODE" -d client_id=$CID -d redirect_uri=http://localhost:33418/callback -d "code_verifier=$VER" | py "d['access_token'] + ' ' + d['scope']")
OTOK=${OT% *}; OSC=${OT#* }
n=$(mcp "$OTOK" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | py "len(d['result']['tools'])")
check "connected agent works with the scope the owner chose ($OSC, $n tools)" "[ '$OSC' = operate ] && [ $n -gt 16 ] && [ $n -lt 33 ]"
rp=$(curl -s -X POST "$B/oauth/token" -d grant_type=authorization_code -d "code=$CODE" -d client_id=$CID -d redirect_uri=http://localhost:33418/callback -d "code_verifier=$VER" | py "d.get('error')")
rc=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/mcp" -H "Authorization: Bearer $OTOK" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "replayed code refused and the access it gave is revoked ($rp, $rc)" "[ '$rp' = invalid_grant ] && [ $rc = 401 ]"

echo "== Agent surfaces & revocation =="
check "llms.txt served" "curl -s '$B/llms.txt' | grep -q 'MCP'"
check "OpenAPI served" "curl -s '$B/api/v1/openapi.json' | grep -q 'get_setup_status'"
check "REST mirror works" "curl -s -X POST '$B/api/v1/tools/get_setup_status' -H 'Authorization: Bearer $AT' | grep -q '\"ok\":true'"
link=$(tool "$AT" get_status_page_link '{}' | py "d['result']['structuredContent']['url']")
check "signed status link opens the read-only status page" "curl -s '$link' | grep -q 'DRY RUN'"
check "status page hidden without login/signature" "[ \$(curl -s -o /dev/null -w '%{http_code}' '$B/status') = 404 ]"
curl -s -b "$W/owner.jar" -o "$W/m2.html" "$B/merchant/setup"; C=$(csrf_of "$W/m2.html")
TID=$(grep -oE '/merchant/tokens/[0-9]+/revoke' "$W/m2.html" | tail -1 | grep -oE '[0-9]+')
post -b "$W/owner.jar" -o /dev/null -X POST "$B/merchant/tokens/$TID/revoke" -d "_csrf=$C"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/mcp" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "revoked token refused immediately ($code)" "[ $code = 401 ]"

echo
echo "Result: $PASS passed, $FAIL failed"
rm -rf "$W"
[ $FAIL -eq 0 ]
