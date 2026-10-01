/* MoltenRock Trade marketing site — vanilla JS, no dependencies. Every effect degrades gracefully:
   without JS the page is complete and readable; with prefers-reduced-motion it stays still. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  /* ---------------------------------------------------------------- i18n */
  const T = {
    de: {
      'nav.how': 'So funktioniert’s', 'nav.features': 'Funktionen', 'nav.agents': 'Für Agenten', 'nav.pricing': 'Preis', 'nav.faq': 'FAQ', 'cta.start': 'Kostenlos starten', 'cta.watch': 'So funktioniert’s',
      'hero.chip': 'Für jeden Schweizer Onlineshop · kostenlos & Fair Source', 'hero.h1a': 'Ihr Shop,', 'hero.h1b': 'jetzt auch', 'hero.h1c': 'im Grosshandel.',
      'hero.lead': 'Ein Schweizer B2B-Handelsportal für Ihren Onlineshop – WooCommerce, Shopify, Wix oder Ihre eigene Website. Stufenpreise, QR-Rechnungen, vier Sprachen. Ihr KI-Agent richtet es ein, während Sie zuschauen. Sie geben nur frei, was zählt.',
      'trust.qr': 'Schweizer QR-Rechnung', 'trust.vat': 'MWST-bereit', 'trust.eu': 'Ihr Cloudflare, Daten in der EU',
      'float.month': 'Diesen Monat', 'float.invoice': 'Rechnung', 'float.net': 'Netto', 'float.applied': 'möchte ein Handelskonto', 'float.approve': 'Freigeben',
      'num.hosting': 'Hosting im Gratis-Plan von Cloudflare', 'num.pages': 'Seiten klicken Sie selbst – den Rest macht Ihr Agent', 'num.defaults': 'sinnvolle Schweizer Voreinstellungen, alle anpassbar', 'num.langs': 'Sprachen für jedes Produkt', 'num.fees': 'Zahlungsgebühren – Kunden zahlen auf Rechnung',
      'how.eyebrow': 'So funktioniert’s', 'how.title': 'Drei Schritte. Zwei davon sind Ihre. Einer ist ein Satz.',
      'how.m1': 'Handelsportal einrichten', 'how.m1a': 'Firma', 'how.m1b': 'Portal erstellen', 'how.m2': 'Konnektor hinzufügen', 'how.m2a': 'Name', 'how.m2b': 'Adresse', 'how.m2c': 'Claude verbinden', 'how.m2d': 'Portal einrichten und betreuen · nie Ihre Bankdaten', 'how.m2e': 'Erlauben',
      'how.say': 'Richte mein Handelsportal ein.', 'how.t1': 'Produkte aus Ihrem Shop gelesen', 'how.t2': '27 Produkte importiert', 'how.t3': 'Texte auf DE, FR, IT und EN', 'how.t4': 'Konditionen mit Ihnen bestätigt', 'how.t5': 'Erster Geschäftskunde eingeladen',
      'how.s1': 'In zwei Minuten angemeldet', 'how.s1p': 'Firma, MWST-Nummer, IBAN – das steht auf Ihren Rechnungen. Ändern kann es nur ein Mensch, nie ein Agent.',
      'how.s2': 'KI-Agenten verbinden', 'how.s2p': 'Eine Adresse in Claude einfügen, anmelden, «Erlauben» klicken. Keine Schlüssel kopieren, keine Konfigurationsdateien. Jederzeit trennbar.',
      'how.s3': 'Sagen Sie: «Richte mein Handelsportal ein.»', 'how.s3p': 'Ihr Agent liest Ihr Sortiment – bei WooCommerce mit einem Lese-Schlüssel, bei jedem anderen Shop direkt von Ihrer Website –, schreibt jedes Produkt auf Deutsch, Französisch, Italienisch und Englisch, geht die Voreinstellungen mit Ihnen durch und lädt Ihren ersten Geschäftskunden ein.',
      'feat.eyebrow': 'Funktionen', 'feat.title': 'Alles, was Schweizer B2B braucht. Nichts, was es nicht braucht.',
      'calc.title': 'Handelspreise, gerechnet wie von Ihrer Treuhänderin', 'calc.sub': 'Rabatt auf den Preis ohne MWST, MWST als eigene Zeile, einmal gerundet. Probieren Sie es aus:', 'calc.list': 'Listenwert im Shop (inkl. MWST)', 'calc.partner': 'Partner −45 %',
      'calc.net': 'Listenpreis netto', 'calc.disc': 'Handelsrabatt', 'calc.subtotal': 'Zwischensumme netto', 'calc.total': 'Rechnungstotal', 'calc.min': 'Unter dem Minimum von CHF 200', 'calc.ok': 'Wird sofort bestätigt', 'calc.appr': 'Über CHF 5’000 – wartet auf Ihre Freigabe',
      'qr.title': 'Eine Schweizer QR-Rechnung zu jeder Bestellung', 'qr.sub': 'Lückenlose Nummern, SCOR- oder QRR-Referenz, MWST-Zeilen, 14 Tage netto. Kein Zahlungsanbieter – Schweizer B2B läuft auf Vertrauen.', 'qr.receipt': 'Empfangsschein', 'qr.account': 'Konto / Zahlbar an', 'qr.amount': 'Betrag', 'qr.payment': 'Zahlteil', 'qr.l1': 'Lückenlose Rechnungsnummern', 'qr.l2': 'SCOR- oder QR-IBAN-Referenz', 'qr.l3': 'MWST je Satz, einmal gerundet', 'qr.l4': 'Gutschriften für Korrekturen', 'qr.l5': 'Druckfertige Seite, PDF auf Wunsch',
      'langs.title': 'Vier Sprachen, ein Sortiment', 'langs.sub': 'Ihr Agent schreibt natürliche Schweizer Texte – «ss», nie «ß». Bei jedem Text sehen Sie, woher er stammt.',
      'appr.title': 'Sie geben frei, was zählt', 'appr.sub': 'Neue Handelskonten, grosse Warenkörbe und Gutschriften warten auf einen Menschen. Ihr Agent bereitet sie vor.', 'appr.rooms': '40 Zimmer', 'appr.note': 'UID geprüft. Auf Standard −40 % freigeben?', 'appr.yes': 'Freigeben', 'appr.no': 'Ablehnen', 'appr.done': 'Freigegeben – Einladung verschickt',
      'lock.title': 'Ihr Shop bleibt schreibgeschützt', 'lock.sub': 'MoltenRock Trade liest Ihren Shop nur – mit einem WooCommerce-Lese-Schlüssel oder von Ihrer öffentlichen Website. Bestellungen an WooCommerce zurückgeben ist optional und aus, bis Sie es einschalten.',
      'dash.title': 'Eine Übersicht, die auf den Punkt kommt', 'dash.sub': 'Was hereinkam, was auf Sie wartet, wer was schuldet – live.',
      'ag.eyebrow': 'Für Agenten', 'ag.title': 'Ein Backoffice, das Ihre KI führt – mit Leitplanken, die Sie setzen.', 'ag.lead': 'Kein Einstellungs-Labyrinth. Ihr Agent arbeitet über MCP – 35 Werkzeuge, eine REST-Schnittstelle und llms.txt. Entscheidungen über Vertrauen und Geld landen immer bei Ihnen.',
      'ag.can': 'Ihr Agent kann', 'ag.c1': 'Ihr Sortiment aus jedem Shop lesen und übersetzen', 'ag.c2': 'Stufen, Mindestbestellung und Zahlungsfristen setzen', 'ag.c3': 'Geschäftskunden einladen', 'ag.c4': 'Freigaben mit Begründung vorbereiten', 'ag.c5': 'Zahlungen verbuchen und Ihnen die Zahlen zeigen',
      'ag.only': 'Nur Sie können', 'ag.o1': 'Firmen-, MWST- und Bankdaten ändern', 'ag.o2': 'Handelskonten und grosse Bestellungen freigeben', 'ag.o3': 'Gutschriften ausstellen', 'ag.o4': 'Agenten verbinden oder trennen',
      'free.eyebrow': 'Preis', 'free.title': 'Kostenlos. Ihres. In der EU.', 'free.tag': 'Selbst betrieben', 'free.month': '/ Monat', 'free.sub': 'In Ihrem eigenen kostenlosen Cloudflare-Konto. Wir sehen weder Ihre Daten noch Ihre Kunden.',
      'free.l1': 'Alles inklusive – keine Funktionen hinter Bezahlschranken', 'free.l2': 'Daten in der EU-Jurisdiktion von Cloudflare', 'free.l3': 'Richtet sich selbst ein: kein Terminal, keine Konfiguration', 'free.l4': 'Fair Source (FSL) – wird nach zwei Jahren Apache 2.0',
      'free.deploy': 'Auf Cloudflare installieren', 'free.fine': 'Rund 15 Minuten. Optional: Der Plan «Workers Paid» von Cloudflare (USD 5 / Monat, abgerechnet von Cloudflare – nicht von uns) ergänzt Rechnungs-PDFs per Klick; die druckfertige QR-Rechnungsseite ist kostenlos.',
      'mac.tag': 'Optional · nur Mac', 'mac.title': 'MoltenRock für Mac', 'mac.sub': 'Unsere Mac-App im App Store. Optional: MoltenRock Trade läuft auf jedem Computer.', 'mac.l1': 'Bewahrt Ihre Geschäftsschlüssel in einem Tresor auf', 'mac.l2': 'Freigeben, was Ihre KI-Agenten tun – mit Touch ID', 'mac.l3': 'Ihr Agent zeigt Ihr Portal live in MoltenView', 'mac.cta': 'Über MoltenRock',
      'faq.eyebrow': 'FAQ', 'faq.title': 'Was Händler fragen', 'faq.q1': 'Brauche ich einen Zahlungsanbieter?', 'faq.a1': 'Nein. Geschäftskunden zahlen per Schweizer QR-Rechnung, standardmässig 14 Tage netto. Keine Kartengebühren, keine Zahlungsintegration.',
      'faq.q2': 'Kann der Agent meinen Shop kaputt machen?', 'faq.a2': 'Nein. Er liest Ihren Shop nur: bei WooCommerce mit einem Lese-Schlüssel, bei jedem anderen Shop über Ihre öffentlichen Produktseiten. Ihre Bankdaten kann er nicht ändern, Preise nicht selbst freischalten, und Kunden oder grosse Bestellungen gibt er nicht frei – die warten auf Sie.',
      'faq.q3': 'Wo sind meine Daten?', 'faq.a3': 'In Ihrem eigenen Cloudflare-Konto, in der EU-Jurisdiktion von Cloudflare. Wir hosten sie nicht und sehen sie nie.',
      'faq.q4': 'Muss ich programmieren?', 'faq.a4': 'Nein. «Auf Cloudflare installieren» klicken, die neue Adresse öffnen, anmelden. Das Portal legt seine Datenbank und Schlüssel selbst an.',
      'faq.q5': 'Welche Agenten funktionieren?', 'faq.a5': 'Jeder Agent, der MCP spricht – zum Beispiel Claude. Andere nutzen die REST-Schnittstelle; alles ist in llms.txt beschrieben.',
      'faq.q6': 'Welche Shopsysteme?', 'faq.a6': 'Jedes. WooCommerce verbindet sich direkt mit einem Lese-Schlüssel, inklusive Polylang- und WPML-Übersetzungen. Shopify, Wix, Squarespace, Ihre eigene Website oder eine Tabelle: Ihr Agent liest Ihre Produkte und Preise, und Sie bestätigen jeden Preis, bevor jemand bestellen kann.',
      'final.a': 'Öffnen Sie Ihr Handelsportal', 'final.b': 'heute Abend.', 'final.lead': 'Zwei Schritte sind Ihre. Den Rest macht Ihr Agent.', 'foot.by': 'Ein Produkt von Goldcote. Gebaut für Schweizer B2B.', 'foot.imprint': 'Impressum', 'nav.start': 'Loslegen', 'free.guide': 'Schritt-für-Schritt-Anleitung →', 'foot.privacy': 'Datenschutz',
      'foot.fine': 'WooCommerce, Shopify, Wix, Squarespace, GitHub und Cloudflare sind Marken ihrer jeweiligen Inhaber. MoltenRock Trade ist mit keinem davon verbunden.',
      'nav.any': 'Jeder Shop', 'nav.home': 'Startseite', 'trust.any': 'Jedes Shopsystem', 'ag.o5': 'Die gefundenen Preise bestätigen', 'any.eyebrow': 'Jeder Shop', 'any.title': 'Ihr Shopsystem spielt keine Rolle.', 'any.lead': 'WooCommerce verbindet sich direkt mit einem Lese-Schlüssel. Shopify, Wix, Squarespace, Ihre eigene Website oder nur eine Tabelle: Ihr Agent liest Ihre Produkte, schreibt sie in vier Sprachen – und Sie bestätigen jeden Preis, bevor ein Geschäftskunde bestellen kann.', 'any.direct': 'direkt · Lese-Schlüssel', 'any.via': 'über Ihren Agenten', 'any.own': 'Ihre eigene Website', 'any.sheet': 'Eine Tabelle', 'any.qTitle': 'Preise bestätigen', 'any.new': 'Neu', 'any.confirm': 'Alle bestätigen', 'any.live': 'Für Ihre Geschäftskunden bestellbar', 'any.p1': 'Leinen-Handtuch', 'any.p2': 'Steingut-Becher', 'any.p3': 'Glasflasche 0,5 l', 'any.p4': 'Raumduft-Diffuser', 'any.c1': 'Ihr Agent liest Ihre Produktseiten', 'any.c2': 'Sie bestätigen jeden Preis – einmal', 'any.c3': 'Ihre Geschäftskunden können bestellen', 'any.note': 'Ändert sich ein Preis auf Ihrer Website, gilt der bestätigte Preis, bis Sie den neuen bestätigen.',
    },
    fr: {
      'nav.how': 'Fonctionnement', 'nav.features': 'Fonctions', 'nav.agents': 'Pour les agents', 'nav.pricing': 'Prix', 'nav.faq': 'FAQ', 'cta.start': 'Commencer gratuitement', 'cta.watch': 'Voir comment ça marche',
      'hero.chip': 'Pour toute boutique en ligne suisse · gratuit & fair source', 'hero.h1a': 'Votre boutique,', 'hero.h1b': 'désormais', 'hero.h1c': 'en gros.',
      'hero.lead': 'Un portail professionnel B2B suisse pour votre boutique en ligne – WooCommerce, Shopify, Wix ou votre propre site. Prix par niveaux, factures QR, quatre langues. Votre agent IA le configure sous vos yeux. Vous ne validez que l’essentiel.',
      'trust.qr': 'Facture QR suisse', 'trust.vat': 'Prêt pour la TVA', 'trust.eu': 'Votre Cloudflare, données dans l’UE',
      'float.month': 'Ce mois-ci', 'float.invoice': 'Facture', 'float.net': 'Net', 'float.applied': 'demande un compte professionnel', 'float.approve': 'Valider',
      'num.hosting': 'd’hébergement avec l’offre gratuite de Cloudflare', 'num.pages': 'pages à cliquer vous-même – le reste, c’est votre agent', 'num.defaults': 'réglages suisses sensés, tous modifiables', 'num.langs': 'langues pour chaque produit', 'num.fees': 'de frais de paiement – vos clients paient sur facture',
      'how.eyebrow': 'Fonctionnement', 'how.title': 'Trois étapes. Deux sont à vous. La troisième tient en une phrase.',
      'how.m1': 'Configurer votre portail', 'how.m1a': 'Entreprise', 'how.m1b': 'Créer le portail', 'how.m2': 'Ajouter un connecteur', 'how.m2a': 'Nom', 'how.m2b': 'Adresse', 'how.m2c': 'Connecter Claude', 'how.m2d': 'Configurer et gérer le portail · jamais vos données bancaires', 'how.m2e': 'Autoriser',
      'how.say': 'Configure mon portail professionnel.', 'how.t1': 'Produits lus depuis votre boutique', 'how.t2': '27 produits importés', 'how.t3': 'Textes en DE, FR, IT et EN', 'how.t4': 'Conditions confirmées avec vous', 'how.t5': 'Premier client professionnel invité',
      'how.s1': 'Inscrit en deux minutes', 'how.s1p': 'Entreprise, numéro de TVA, IBAN – ce qui figure sur vos factures. Seule une personne peut les modifier, jamais un agent.',
      'how.s2': 'Connectez votre agent IA', 'how.s2p': 'Collez une adresse dans Claude, connectez-vous, cliquez sur « Autoriser ». Aucune clé à copier, aucun fichier de configuration. Déconnectable à tout moment.',
      'how.s3': 'Dites : « Configure mon portail professionnel. »', 'how.s3p': 'Votre agent lit votre assortiment – avec une clé en lecture seule sur WooCommerce, directement sur votre site pour toute autre boutique –, rédige chaque produit en allemand, français, italien et anglais, passe les réglages en revue avec vous et invite votre premier client.',
      'feat.eyebrow': 'Fonctions', 'feat.title': 'Tout ce dont le B2B suisse a besoin. Rien de superflu.',
      'calc.title': 'Des prix professionnels calculés comme le ferait votre fiduciaire', 'calc.sub': 'Remise sur le prix hors TVA, TVA sur sa propre ligne, arrondie une fois. Essayez :', 'calc.list': 'Valeur catalogue (TVA incl.)', 'calc.partner': 'Partenaire −45 %',
      'calc.net': 'Prix catalogue net', 'calc.disc': 'Remise professionnelle', 'calc.subtotal': 'Sous-total net', 'calc.total': 'Total de la facture', 'calc.min': 'Sous le minimum de CHF 200', 'calc.ok': 'Confirmée immédiatement', 'calc.appr': 'Plus de CHF 5 000 – attend votre validation',
      'qr.title': 'Une facture QR suisse pour chaque commande', 'qr.sub': 'Numéros sans trou, référence SCOR ou QRR, lignes de TVA, 14 jours net. Aucun prestataire de paiement – le B2B suisse repose sur la confiance.', 'qr.receipt': 'Récépissé', 'qr.account': 'Compte / Payable à', 'qr.amount': 'Montant', 'qr.payment': 'Section paiement', 'qr.l1': 'Numéros de facture sans trou', 'qr.l2': 'Référence SCOR ou QR-IBAN', 'qr.l3': 'TVA par taux, arrondie une fois', 'qr.l4': 'Notes de crédit pour corriger', 'qr.l5': 'Page prête à imprimer, PDF sur demande',
      'langs.title': 'Quatre langues, un assortiment', 'langs.sub': 'Votre agent rédige des textes naturels. Chaque texte indique d’où il vient.',
      'appr.title': 'Vous validez l’essentiel', 'appr.sub': 'Nouveaux comptes, gros paniers et notes de crédit attendent une personne. Votre agent les prépare.', 'appr.rooms': '40 chambres', 'appr.note': 'IDE vérifié. Valider en Standard −40 % ?', 'appr.yes': 'Valider', 'appr.no': 'Refuser', 'appr.done': 'Validé – invitation envoyée',
      'lock.title': 'Votre boutique reste en lecture seule', 'lock.sub': 'MoltenRock Trade ne fait que lire votre boutique – avec une clé WooCommerce en lecture seule ou depuis votre site public. Renvoyer les commandes vers WooCommerce est facultatif et désactivé jusqu’à ce que vous l’activiez.',
      'dash.title': 'Un tableau de bord qui va à l’essentiel', 'dash.sub': 'Ce qui est arrivé, ce qui vous attend, qui doit quoi – en direct.',
      'ag.eyebrow': 'Pour les agents', 'ag.title': 'Un back-office géré par votre IA – avec les garde-fous que vous fixez.', 'ag.lead': 'Pas de labyrinthe de réglages. Votre agent travaille via MCP – 35 outils, une API REST et llms.txt. Les décisions de confiance et d’argent vous reviennent toujours.',
      'ag.can': 'Votre agent peut', 'ag.c1': 'Lire votre assortiment depuis n’importe quelle boutique et le traduire', 'ag.c2': 'Fixer niveaux, minimums et délais de paiement', 'ag.c3': 'Inviter des clients professionnels', 'ag.c4': 'Préparer des validations avec ses raisons', 'ag.c5': 'Enregistrer des paiements et vous montrer les chiffres',
      'ag.only': 'Vous seul pouvez', 'ag.o1': 'Modifier les données de l’entreprise, de TVA et bancaires', 'ag.o2': 'Valider les comptes et les grosses commandes', 'ag.o3': 'Émettre des notes de crédit', 'ag.o4': 'Connecter ou déconnecter des agents',
      'free.eyebrow': 'Prix', 'free.title': 'Gratuit. À vous. Dans l’UE.', 'free.tag': 'Auto-hébergé', 'free.month': '/ mois', 'free.sub': 'Sur votre propre compte Cloudflare gratuit. Nous ne voyons ni vos données ni vos clients.',
      'free.l1': 'Tout inclus – aucune fonction payante', 'free.l2': 'Données dans la juridiction UE de Cloudflare', 'free.l3': 'Se configure seul : ni terminal, ni configuration', 'free.l4': 'Fair source (FSL) – devient Apache 2.0 après deux ans',
      'free.deploy': 'Déployer sur Cloudflare', 'free.fine': 'Environ 15 minutes. En option : l’offre « Workers Paid » de Cloudflare (USD 5 / mois, facturée par Cloudflare – pas par nous) ajoute les PDF de facture en un clic ; la page de facture QR prête à imprimer est gratuite.',
      'mac.tag': 'Optionnel · Mac uniquement', 'mac.title': 'MoltenRock pour Mac', 'mac.sub': 'Notre app Mac, sur l’App Store. Optionnel : MoltenRock Trade fonctionne sur n’importe quel ordinateur.', 'mac.l1': 'Garde vos clés d’entreprise dans un coffre', 'mac.l2': 'Validez avec Touch ID ce que font vos agents IA', 'mac.l3': 'Votre agent affiche votre portail en direct dans MoltenView', 'mac.cta': 'À propos de MoltenRock',
      'faq.eyebrow': 'FAQ', 'faq.title': 'Les questions des commerçants', 'faq.q1': 'Ai-je besoin d’un prestataire de paiement ?', 'faq.a1': 'Non. Les clients professionnels paient par facture QR suisse, 14 jours net par défaut. Pas de frais de carte, pas d’intégration de paiement.',
      'faq.q2': 'L’agent peut-il casser ma boutique ?', 'faq.a2': 'Non. Il ne fait que lire votre boutique : avec une clé en lecture seule sur WooCommerce, ou vos pages produits publiques pour toute autre boutique. Il ne peut pas toucher à vos données bancaires, ni rendre un prix actif, ni valider des clients ou de grosses commandes – ils vous attendent.',
      'faq.q3': 'Où sont mes données ?', 'faq.a3': 'Dans votre propre compte Cloudflare, dans la juridiction UE de Cloudflare. Nous ne les hébergeons pas et ne les voyons jamais.',
      'faq.q4': 'Dois-je savoir coder ?', 'faq.a4': 'Non. Cliquez sur « Déployer sur Cloudflare », ouvrez votre nouvelle adresse, inscrivez-vous. Le portail crée lui-même sa base de données et ses clés.',
      'faq.q5': 'Quels agents fonctionnent ?', 'faq.a5': 'Tout agent qui parle MCP – par exemple Claude. Les autres utilisent l’API REST ; tout est décrit dans llms.txt.',
      'faq.q6': 'Quels systèmes de boutique ?', 'faq.a6': 'Tous. WooCommerce se connecte directement avec une clé en lecture seule, traductions Polylang et WPML comprises. Shopify, Wix, Squarespace, votre propre site ou un tableau : votre agent lit vos produits et leurs prix, et vous confirmez chaque prix avant que quiconque puisse commander.',
      'final.a': 'Ouvrez votre portail professionnel', 'final.b': 'ce soir.', 'final.lead': 'Deux étapes sont à vous. Votre agent fait le reste.', 'foot.by': 'Un produit Goldcote. Conçu pour le B2B suisse.', 'foot.imprint': 'Mentions légales', 'nav.start': 'Commencer', 'free.guide': 'Guide étape par étape →', 'foot.privacy': 'Protection des données',
      'foot.fine': 'WooCommerce, Shopify, Wix, Squarespace, GitHub et Cloudflare sont des marques de leurs propriétaires respectifs. MoltenRock Trade n’est affilié à aucun d’eux.',
      'nav.any': 'Toute boutique', 'nav.home': 'Accueil', 'trust.any': 'Toute boutique', 'ag.o5': 'Confirmer les prix qu’il a trouvés', 'any.eyebrow': 'Toute boutique', 'any.title': 'Votre système de boutique n’a pas d’importance.', 'any.lead': 'WooCommerce se connecte directement avec une clé en lecture seule. Shopify, Wix, Squarespace, votre propre site ou un simple tableau : votre agent lit vos produits, les rédige en quatre langues – et vous confirmez chaque prix avant qu’un client professionnel puisse commander.', 'any.direct': 'direct · clé en lecture seule', 'any.via': 'via votre agent', 'any.own': 'Votre propre site', 'any.sheet': 'Un tableau', 'any.qTitle': 'Prix à confirmer', 'any.new': 'Nouveau', 'any.confirm': 'Tout confirmer', 'any.live': 'Commandable par vos clients professionnels', 'any.p1': 'Essuie-mains en lin', 'any.p2': 'Mug en grès', 'any.p3': 'Bouteille en verre 0,5 l', 'any.p4': 'Diffuseur d’ambiance', 'any.c1': 'Votre agent lit vos pages produits', 'any.c2': 'Vous confirmez chaque prix – une fois', 'any.c3': 'Vos clients professionnels peuvent commander', 'any.note': 'Un prix change sur votre site ? Le prix confirmé reste en vigueur jusqu’à ce que vous confirmiez le nouveau.',
    },
    it: {
      'nav.how': 'Come funziona', 'nav.features': 'Funzioni', 'nav.agents': 'Per gli agenti', 'nav.pricing': 'Prezzo', 'nav.faq': 'FAQ', 'cta.start': 'Inizia gratis', 'cta.watch': 'Guarda come funziona',
      'hero.chip': 'Per ogni negozio online svizzero · gratuito & fair source', 'hero.h1a': 'Il suo negozio,', 'hero.h1b': 'ora anche', 'hero.h1c': 'all’ingrosso.',
      'hero.lead': 'Un portale B2B svizzero per il suo negozio online – WooCommerce, Shopify, Wix o il suo sito. Prezzi a livelli, fatture QR, quattro lingue. Il suo agente IA lo configura sotto i suoi occhi. Lei approva solo ciò che conta.',
      'trust.qr': 'Fattura QR svizzera', 'trust.vat': 'Pronto per l’IVA', 'trust.eu': 'Il suo Cloudflare, dati nell’UE',
      'float.month': 'Questo mese', 'float.invoice': 'Fattura', 'float.net': 'Netto', 'float.applied': 'chiede un conto commerciale', 'float.approve': 'Approva',
      'num.hosting': 'di hosting con il piano gratuito di Cloudflare', 'num.pages': 'pagine da cliccare di persona – il resto lo fa il suo agente', 'num.defaults': 'impostazioni svizzere sensate, tutte modificabili', 'num.langs': 'lingue per ogni prodotto', 'num.fees': 'di commissioni – i clienti pagano con fattura',
      'how.eyebrow': 'Come funziona', 'how.title': 'Tre passi. Due sono suoi. Il terzo è una frase.',
      'how.m1': 'Configurare il portale', 'how.m1a': 'Azienda', 'how.m1b': 'Crea il portale', 'how.m2': 'Aggiungi connettore', 'how.m2a': 'Nome', 'how.m2b': 'Indirizzo', 'how.m2c': 'Collega Claude', 'how.m2d': 'Configurare e gestire il portale · mai i suoi dati bancari', 'how.m2e': 'Consenti',
      'how.say': 'Configura il mio portale per rivenditori.', 'how.t1': 'Prodotti letti dal suo negozio', 'how.t2': '27 prodotti importati', 'how.t3': 'Testi in DE, FR, IT ed EN', 'how.t4': 'Condizioni confermate con lei', 'how.t5': 'Primo cliente commerciale invitato',
      'how.s1': 'Registrato in due minuti', 'how.s1p': 'Azienda, numero IVA, IBAN – ciò che compare sulle fatture. Solo una persona può modificarli, mai un agente.',
      'how.s2': 'Colleghi il suo agente IA', 'how.s2p': 'Incolli un indirizzo in Claude, acceda, clicchi «Consenti». Nessuna chiave da copiare, nessun file di configurazione. Scollegabile in ogni momento.',
      'how.s3': 'Dica: «Configura il mio portale per rivenditori.»', 'how.s3p': 'Il suo agente legge l’assortimento – con una chiave di sola lettura su WooCommerce, direttamente dal suo sito per qualsiasi altro negozio –, scrive ogni prodotto in tedesco, francese, italiano e inglese, rivede con lei le impostazioni e invita il primo cliente.',
      'feat.eyebrow': 'Funzioni', 'feat.title': 'Tutto ciò che serve al B2B svizzero. Niente di superfluo.',
      'calc.title': 'Prezzi commerciali calcolati come farebbe la sua fiduciaria', 'calc.sub': 'Sconto sul prezzo senza IVA, IVA su una riga propria, arrotondata una volta. Provi:', 'calc.list': 'Valore di listino (IVA incl.)', 'calc.partner': 'Partner −45 %',
      'calc.net': 'Prezzo di listino netto', 'calc.disc': 'Sconto commerciale', 'calc.subtotal': 'Subtotale netto', 'calc.total': 'Totale fattura', 'calc.min': 'Sotto il minimo di CHF 200', 'calc.ok': 'Confermato subito', 'calc.appr': 'Oltre CHF 5’000 – attende la sua approvazione',
      'qr.title': 'Una fattura QR svizzera per ogni ordine', 'qr.sub': 'Numeri senza lacune, riferimento SCOR o QRR, righe IVA, 14 giorni netto. Nessun fornitore di pagamento – il B2B svizzero si basa sulla fiducia.', 'qr.receipt': 'Ricevuta', 'qr.account': 'Conto / Pagabile a', 'qr.amount': 'Importo', 'qr.payment': 'Sezione pagamento', 'qr.l1': 'Numeri di fattura senza lacune', 'qr.l2': 'Riferimento SCOR o QR-IBAN', 'qr.l3': 'IVA per aliquota, arrotondata una volta', 'qr.l4': 'Note di credito per le correzioni', 'qr.l5': 'Pagina pronta da stampare, PDF su richiesta',
      'langs.title': 'Quattro lingue, un assortimento', 'langs.sub': 'Il suo agente scrive testi naturali. Per ogni testo vede da dove proviene.',
      'appr.title': 'Lei approva ciò che conta', 'appr.sub': 'Nuovi conti, carrelli importanti e note di credito attendono una persona. Il suo agente li prepara.', 'appr.rooms': '40 camere', 'appr.note': 'IDI verificato. Approvare su Standard −40 %?', 'appr.yes': 'Approva', 'appr.no': 'Rifiuta', 'appr.done': 'Approvato – invito inviato',
      'lock.title': 'Il suo negozio resta in sola lettura', 'lock.sub': 'MoltenRock Trade legge soltanto il suo negozio – con una chiave WooCommerce di sola lettura o dal suo sito pubblico. Restituire gli ordini a WooCommerce è facoltativo e spento finché non lo attiva.',
      'dash.title': 'Una panoramica che va al punto', 'dash.sub': 'Cosa è arrivato, cosa la aspetta, chi deve cosa – in tempo reale.',
      'ag.eyebrow': 'Per gli agenti', 'ag.title': 'Un back office gestito dalla sua IA – con i limiti che fissa lei.', 'ag.lead': 'Nessun labirinto di impostazioni. Il suo agente lavora via MCP – 35 strumenti, un’API REST e llms.txt. Le decisioni di fiducia e di denaro tornano sempre a lei.',
      'ag.can': 'Il suo agente può', 'ag.c1': 'Leggere l’assortimento da qualsiasi negozio e tradurlo', 'ag.c2': 'Impostare livelli, minimi e termini di pagamento', 'ag.c3': 'Invitare clienti commerciali', 'ag.c4': 'Preparare approvazioni con le sue ragioni', 'ag.c5': 'Registrare pagamenti e mostrarle i numeri',
      'ag.only': 'Solo lei può', 'ag.o1': 'Modificare dati aziendali, IVA e bancari', 'ag.o2': 'Approvare conti e ordini importanti', 'ag.o3': 'Emettere note di credito', 'ag.o4': 'Collegare o scollegare agenti',
      'free.eyebrow': 'Prezzo', 'free.title': 'Gratuito. Suo. Nell’UE.', 'free.tag': 'Self-hosted', 'free.month': '/ mese', 'free.sub': 'Sul suo account Cloudflare gratuito. Non vediamo né i suoi dati né i suoi clienti.',
      'free.l1': 'Tutto incluso – nessuna funzione a pagamento', 'free.l2': 'Dati nella giurisdizione UE di Cloudflare', 'free.l3': 'Si configura da solo: niente terminale, niente configurazione', 'free.l4': 'Fair source (FSL) – diventa Apache 2.0 dopo due anni',
      'free.deploy': 'Installa su Cloudflare', 'free.fine': 'Circa 15 minuti. Facoltativo: il piano «Workers Paid» di Cloudflare (USD 5 / mese, fatturato da Cloudflare – non da noi) aggiunge i PDF delle fatture con un clic; la pagina della fattura QR pronta da stampare è gratuita.',
      'mac.tag': 'Facoltativo · solo Mac', 'mac.title': 'MoltenRock per Mac', 'mac.sub': 'La nostra app per Mac, sull’App Store. Facoltativa: MoltenRock Trade funziona su qualsiasi computer.', 'mac.l1': 'Custodisce le chiavi aziendali in una cassaforte', 'mac.l2': 'Approvi con Touch ID ciò che fanno i suoi agenti IA', 'mac.l3': 'Il suo agente mostra il portale in tempo reale in MoltenView', 'mac.cta': 'Informazioni su MoltenRock',
      'faq.eyebrow': 'FAQ', 'faq.title': 'Le domande dei commercianti', 'faq.q1': 'Mi serve un fornitore di pagamento?', 'faq.a1': 'No. I clienti commerciali pagano con fattura QR svizzera, 14 giorni netto di default. Nessuna commissione sulle carte, nessuna integrazione di pagamento.',
      'faq.q2': 'L’agente può rompere il mio negozio?', 'faq.a2': 'No. Legge soltanto il suo negozio: con una chiave di sola lettura su WooCommerce, o dalle pagine prodotto pubbliche per qualsiasi altro negozio. Non può toccare i dati bancari, né attivare un prezzo, né approvare clienti od ordini importanti – attendono lei.',
      'faq.q3': 'Dove sono i miei dati?', 'faq.a3': 'Nel suo account Cloudflare, nella giurisdizione UE di Cloudflare. Non li ospitiamo e non li vediamo mai.',
      'faq.q4': 'Devo saper programmare?', 'faq.a4': 'No. Clicchi «Installa su Cloudflare», apra il nuovo indirizzo, si registri. Il portale crea da solo database e chiavi.',
      'faq.q5': 'Quali agenti funzionano?', 'faq.a5': 'Qualsiasi agente che parla MCP – per esempio Claude. Gli altri usano l’API REST; tutto è descritto in llms.txt.',
      'faq.q6': 'Quali sistemi di negozio?', 'faq.a6': 'Tutti. WooCommerce si collega direttamente con una chiave di sola lettura, incluse le traduzioni Polylang e WPML. Shopify, Wix, Squarespace, il suo sito o una tabella: il suo agente legge prodotti e prezzi, e lei conferma ogni prezzo prima che qualcuno possa ordinare.',
      'final.a': 'Apra il suo portale per rivenditori', 'final.b': 'stasera.', 'final.lead': 'Due passi sono suoi. Il resto lo fa il suo agente.', 'foot.by': 'Un prodotto Goldcote. Pensato per il B2B svizzero.', 'foot.imprint': 'Note legali', 'nav.start': 'Iniziare', 'free.guide': 'Guida passo dopo passo →', 'foot.privacy': 'Protezione dei dati',
      'foot.fine': 'WooCommerce, Shopify, Wix, Squarespace, GitHub e Cloudflare sono marchi dei rispettivi titolari. MoltenRock Trade non è affiliato a nessuno di essi.',
      'nav.any': 'Ogni negozio', 'nav.home': 'Home', 'trust.any': 'Qualsiasi negozio', 'ag.o5': 'Confermare i prezzi che ha trovato', 'any.eyebrow': 'Ogni negozio', 'any.title': 'Il sistema del suo negozio non conta.', 'any.lead': 'WooCommerce si collega direttamente con una chiave di sola lettura. Shopify, Wix, Squarespace, il suo sito o una semplice tabella: il suo agente legge i prodotti, li scrive in quattro lingue – e lei conferma ogni prezzo prima che un cliente commerciale possa ordinare.', 'any.direct': 'diretto · chiave di sola lettura', 'any.via': 'tramite il suo agente', 'any.own': 'Il suo sito', 'any.sheet': 'Una tabella', 'any.qTitle': 'Prezzi da confermare', 'any.new': 'Nuovo', 'any.confirm': 'Conferma tutti', 'any.live': 'Ordinabile dai suoi clienti commerciali', 'any.p1': 'Asciugamano in lino', 'any.p2': 'Tazza in gres', 'any.p3': 'Bottiglia in vetro 0,5 l', 'any.p4': 'Diffusore per ambienti', 'any.c1': 'Il suo agente legge le pagine prodotto', 'any.c2': 'Lei conferma ogni prezzo – una volta', 'any.c3': 'I suoi clienti commerciali possono ordinare', 'any.note': 'Un prezzo cambia sul suo sito? Il prezzo confermato resta valido finché lei non conferma quello nuovo.',
    },
  };
  const CHAT = {
    en: { user: 'Set up my trade portal.', lines: [['get_setup_status', 'Let’s go. Connecting your shop — read-only.'], ['import_catalog', 'Imported 27 products in 4 languages.'], ['bulk_set_translations', 'Writing the French and Italian texts…', true], ['update_settings', 'Terms set: Standard −40 %, VIP −50 %, Net 14, min. CHF 200.'], ['invite_partner', 'Invited Hôtel Beau-Séjour SA — they can order now. ✓']], approved: 'Approved ✓' },
    de: { user: 'Richte mein Handelsportal ein.', lines: [['get_setup_status', 'Los geht’s. Ich verbinde Ihren Shop – nur lesend.'], ['import_catalog', '27 Produkte in 4 Sprachen importiert.'], ['bulk_set_translations', 'Ich schreibe die französischen und italienischen Texte …', true], ['update_settings', 'Konditionen: Standard −40 %, VIP −50 %, 14 Tage netto, Minimum CHF 200.'], ['invite_partner', 'Hôtel Beau-Séjour SA eingeladen – kann jetzt bestellen. ✓']], approved: 'Freigegeben ✓' },
    fr: { user: 'Configure mon portail professionnel.', lines: [['get_setup_status', 'C’est parti. Je connecte votre boutique – en lecture seule.'], ['import_catalog', '27 produits importés en 4 langues.'], ['bulk_set_translations', 'Je rédige les textes français et italiens…', true], ['update_settings', 'Conditions : Standard −40 %, VIP −50 %, 14 jours net, minimum CHF 200.'], ['invite_partner', 'Hôtel Beau-Séjour SA invité – il peut commander. ✓']], approved: 'Validé ✓' },
    it: { user: 'Configura il mio portale per rivenditori.', lines: [['get_setup_status', 'Si parte. Collego il suo negozio – in sola lettura.'], ['import_catalog', '27 prodotti importati in 4 lingue.'], ['bulk_set_translations', 'Scrivo i testi in francese e italiano…', true], ['update_settings', 'Condizioni: Standard −40 %, VIP −50 %, 14 giorni netto, minimo CHF 200.'], ['invite_partner', 'Hôtel Beau-Séjour SA invitato – può ordinare. ✓']], approved: 'Approvato ✓' },
  };
  // Pages can add their own translations (e.g. the legal pages) via window.MT_I18N_EXTRA.
  const EXTRA = window.MT_I18N_EXTRA || {};
  for (const l of Object.keys(EXTRA)) T[l] = Object.assign(T[l] || {}, EXTRA[l]);

  const PRODUCT = {
    de: ['Olivenöl extra vergine, 500 ml', 'Kaltgepresst, aus einer einzigen Ernte. Für Küche, Feinkost und Geschenkboxen.', 'imported'],
    fr: ['Huile d’olive extra vierge, 500 ml', 'Pressée à froid, d’une seule récolte. Pour la cuisine, l’épicerie fine et les coffrets cadeaux.', 'agent'],
    it: ['Olio extravergine d’oliva, 500 ml', 'Spremuto a freddo, da un unico raccolto. Per la cucina, la gastronomia e le confezioni regalo.', 'agent'],
    en: ['Extra virgin olive oil, 500 ml', 'Cold-pressed from a single harvest. For kitchens, delis and gift boxes.', 'agent'],
  };
  const PROV = { en: { imported: 'imported', agent: 'by agent' }, de: { imported: 'importiert', agent: 'vom Agenten' }, fr: { imported: 'importé', agent: 'par l’agent' }, it: { imported: 'importato', agent: 'dall’agente' } };
  const LOCALE = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-CH' };

  const EN = {};
  $$('[data-i18n]').forEach((el) => { const k = el.dataset.i18n; if (!(k in EN)) EN[k] = el.textContent; });
  let lang = 'en';
  const onLang = [];
  function setLang(l) {
    lang = T[l] || l === 'en' ? l : 'en';
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { const v = (T[lang] || {})[el.dataset.i18n] ?? EN[el.dataset.i18n]; if (v != null) el.textContent = v; });
    $$('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    store.set('mt-lang', lang);
    // Sub-pages (legal notice, privacy, 404): the browser tab follows the translated heading.
    const h1 = document.body.classList.contains('subpage') && $('h1');
    if (h1) document.title = `${h1.textContent} — MoltenRock Trade`;
    onLang.forEach((fn) => fn(lang));
  }
  $$('.lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  const q = new URLSearchParams(location.search).get('lang');
  const nav0 = (navigator.language || 'en').slice(0, 2);
  const initial = [q, store.get('mt-lang'), nav0].find((x) => x && (T[x] || x === 'en')) || 'en';

  /* ---------------------------------------------------------------- nav + progress + reveal */
  const navEl = $('.nav'), bar = $('.progress span');
  const onScroll = () => {
    navEl.classList.toggle('scrolled', scrollY > 30);
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
  };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const revealIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    revealIO.unobserve(e.target);
  }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el) => revealIO.observe(el));
  $$('.mini-bars i').forEach((i, n) => i.style.setProperty('--i', n));

  /* ---------------------------------------------------------------- count-up */
  const countIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    countIO.unobserve(e.target);
    const el = e.target, to = Number(el.dataset.count), pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    if (calm) return;
    const from = to === 0 ? 120 : 0, t0 = performance.now(), dur = 1600;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), k = 1 - Math.pow(1 - p, 4); el.textContent = pre + Math.round(from + (to - from) * k) + suf; if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((el) => countIO.observe(el));

  /* ---------------------------------------------------------------- molten WebGL background */
  const hero = $('.hero'), canvas = $('.lava');
  const mouse = { x: 0.7, y: 0.6, tx: 0.7, ty: 0.6 };
  (function lava() {
    if (!hero) return;
    const gl = canvas && canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) { if (canvas) canvas.remove(); return; }
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `precision mediump float;uniform vec2 r;uniform float t;uniform vec2 m;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
      float fb(vec2 p){float v=0.,a=.5;mat2 R=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n(p);p=R*p*2.03+.17;a*=.5;}return v;}
      void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=(gl_FragCoord.xy-.5*r)/r.y;p+=(m-.5)*.12;float T=t*.05;
        vec2 q=vec2(fb(p*1.5+T),fb(p*1.5-T+3.1));
        vec2 w=vec2(fb(p*1.3+2.2*q+vec2(1.7,9.2)+.8*T),fb(p*1.3+2.2*q+vec2(8.3,2.8)-.6*T));
        float f=fb(p*1.15+2.7*w);
        vec3 c=mix(vec3(.04,.03,.035),vec3(.42,.08,.02),smoothstep(.24,.58,f));
        c=mix(c,vec3(1.,.33,.07),smoothstep(.44,.74,f*f*1.45+.26*length(q)));
        c=mix(c,vec3(1.,.76,.4),smoothstep(.7,.94,f*1.08+.18*w.x));
        c+=vec3(1.,.4,.12)*(.16/(1.+16.*length((uv-m)*vec2(r.x/r.y,1.))));
        c*=smoothstep(1.35,.15,length(p*vec2(.85,1.15)));
        c*=mix(.38,1.,smoothstep(-.35,.55,p.x+.25));
        gl_FragColor=vec4(c,1.);}`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, 'r'), uT = gl.getUniformLocation(prog, 't'), uM = gl.getUniformLocation(prog, 'm');
    const scale = Math.min(1, 0.55 * (devicePixelRatio || 1));
    const size = () => { canvas.width = Math.max(1, canvas.clientWidth * scale | 0); canvas.height = Math.max(1, canvas.clientHeight * scale | 0); gl.viewport(0, 0, canvas.width, canvas.height); };
    size(); addEventListener('resize', size);
    let visible = true, start = performance.now();
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !calm) requestAnimationFrame(frame); }).observe(hero);
    function frame(now) {
      mouse.x += (mouse.tx - mouse.x) * 0.04; mouse.y += (mouse.ty - mouse.y) * 0.04;
      gl.uniform2f(uR, canvas.width, canvas.height); gl.uniform1f(uT, (now - start) / 1000 + 20); gl.uniform2f(uM, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (visible && !calm) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  /* ---------------------------------------------------------------- hero: 3D tilt + live agent session */
  const scene = $('.scene');
  if (hero) hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    mouse.tx = x; mouse.ty = 1 - y;
    if (!calm && scene) { scene.style.setProperty('--rx', `${6 - (y - 0.5) * 10}deg`); scene.style.setProperty('--ry', `${-14 + (x - 0.5) * 16}deg`); }
  });
  if (hero) hero.addEventListener('pointerleave', () => { if (scene) { scene.style.setProperty('--rx', '6deg'); scene.style.setProperty('--ry', '-14deg'); } });

  const chat = $('#chat'), toast = $('.toast-float');
  let chatRun = 0, heroVisible = true;
  if (hero) new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; }).observe(hero);
  const wait = (ms) => new Promise((res) => setTimeout(res, calm ? 0 : ms));
  const add = (cls, html) => { const d = document.createElement('div'); d.className = `msg ${cls}`; d.innerHTML = html; chat.appendChild(d); while (chat.children.length > 6) chat.firstChild.remove(); return d; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function session() {
    const run = ++chatRun;
    for (;;) {
      const c = CHAT[lang] || CHAT.en;
      chat.innerHTML = ''; toast.classList.remove('approved'); $('button', toast).textContent = (T[lang] || {})['float.approve'] || EN['float.approve'];
      await wait(700); if (run !== chatRun) return;
      add('user', esc(c.user));
      for (const [tool, text, progress] of c.lines) {
        await wait(650); if (run !== chatRun) return;
        const typing = add('agent typing', '<i></i><i></i><i></i>');
        await wait(900); if (run !== chatRun) return;
        typing.remove();
        add('agent', `<span class="tool">${tool}</span>${esc(text)}${progress ? '<span class="bar"><b></b></span>' : ''}`);
        await wait(progress ? 1700 : 900); if (run !== chatRun) return;
      }
      await wait(900); if (run !== chatRun) return;
      toast.classList.add('approved'); $('button', toast).textContent = c.approved;
      await wait(4200); if (run !== chatRun) return;
      if (calm) return; // reduced motion: one pass, then stay still
      while (!heroVisible && run === chatRun) await wait(800);
    }
  }
  if (chat && toast) onLang.push(() => session());

  /* ---------------------------------------------------------------- how it works: scroll-driven */
  const screens = $$('.screen'), steps = $$('.step');
  let typingJob = 0;
  async function typeInputs() {
    const job = ++typingJob;
    for (const el of $$('.s1 .typed')) el.textContent = '';
    for (const el of $$('.s1 .typed')) {
      const s = el.dataset.type;
      for (let i = 1; i <= s.length; i++) { if (job !== typingJob) return; el.textContent = s.slice(0, i); await wait(38); }
      await wait(220);
    }
  }
  let tickJob = 0;
  async function tick() {
    const job = ++tickJob, items = $$('.ticks li');
    items.forEach((li) => li.classList.remove('done'));
    for (const li of items) { await wait(520); if (job !== tickJob) return; li.classList.add('done'); }
  }
  function show(id) {
    screens.forEach((s) => s.classList.toggle('on', s.classList.contains(id)));
    steps.forEach((s) => s.classList.toggle('active', s.dataset.screen === id));
    if (id === 's1') typeInputs(); else typingJob++;
    if (id === 's3') tick(); else tickJob++;
  }
  const stepIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) show(e.target.dataset.screen); }), { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => stepIO.observe(s));
  if (steps[0]) steps[0].classList.add('active');

  /* ---------------------------------------------------------------- calculator */
  const range = $('#basket'), out = $('#basket-out');
  let tierBp = 4000;
  const shown = {};
  const money = (v) => new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency: 'CHF', minimumFractionDigits: 2 }).format(v);
  function tween(id, to, prefix = '') {
    const el = $(`#${id}`); if (!el) return;
    const from = shown[id] ?? to, t0 = performance.now(), dur = calm ? 0 : 420;
    shown[id] = to;
    el.classList.add('tick'); setTimeout(() => el.classList.remove('tick'), 300);
    const step = (t) => { const p = dur ? Math.min(1, (t - t0) / dur) : 1, k = 1 - Math.pow(1 - p, 3); el.textContent = prefix + money(from + (to - from) * k); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function calc() {
    if (!range) return;
    const gross = Number(range.value);
    range.style.setProperty('--p', `${((gross - range.min) / (range.max - range.min)) * 100}%`);
    out.textContent = new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency: 'CHF', maximumFractionDigits: 0 }).format(gross);
    // Same rules as the portal: net = gross ÷ 1.081, discount on the net price, VAT 8.1 % on the net subtotal, rounded to the rappen.
    const rp = (x) => Math.round(x * 100) / 100;
    const netList = rp(gross / 1.081), disc = rp(netList * tierBp / 10000), net = rp(netList - disc), vat = rp(net * 0.081);
    tween('c-list', netList); tween('c-disc', disc, '− '); tween('c-net', net); tween('c-vat', vat); tween('c-total', rp(net + vat));
    $('#f-min').classList.toggle('show', net < 200);
    $('#f-ok').classList.toggle('show', net >= 200 && net <= 5000);
    $('#f-appr').classList.toggle('show', net > 5000);
  }
  if (range) {
    range.addEventListener('input', calc);
    $$('.seg button').forEach((b) => b.addEventListener('click', () => { $$('.seg button').forEach((x) => x.classList.toggle('on', x === b)); tierBp = Number(b.dataset.tier); calc(); }));
    onLang.push(calc);
  }

  /* ---------------------------------------------------------------- QR code (decorative, with Swiss cross) */
  const qr = $('#qr-grid');
  if (qr) {
    const N = 25, rnd = ((s) => () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)(1770), frag = document.createDocumentFragment();
    const finder = (r, c) => { for (const [fr, fc] of [[0, 0], [0, N - 7], [N - 7, 0]]) { const y = r - fr, x = c - fc; if (y >= 0 && y < 7 && x >= 0 && x < 7) return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4) ? 1 : 0; } return -1; };
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const f = finder(r, c);
      const inCross = r >= 10 && r <= 14 && c >= 10 && c <= 14;
      const quiet = (r === 7 && c < 8) || (c === 7 && r < 8) || (r === 7 && c > N - 9) || (c === N - 8 && r < 8) || (r === N - 8 && c < 8) || (c === 7 && r > N - 9);
      if (f === 0 || inCross || quiet || (f === -1 && rnd() < 0.52)) continue;
      const i = document.createElement('i');
      i.style.gridRow = r + 1; i.style.gridColumn = c + 1; i.style.setProperty('--q', `${((r + c) / (2 * N)) * 1.1}s`);
      frag.appendChild(i);
    }
    const cross = document.createElement('span'); cross.className = 'cross'; frag.appendChild(cross);
    qr.appendChild(frag);
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { qr.classList.add('in'); o.disconnect(); } }, { threshold: 0.4 }).observe(qr);
  }

  /* ---------------------------------------------------------------- language product card */
  const product = $('.product');
  let pl = 'de', plTimer = null, manual = false;
  function setProduct(l) {
    pl = l;
    product.classList.add('swap');
    setTimeout(() => {
      const [name, desc, prov] = PRODUCT[l];
      $('#p-name').textContent = name; $('#p-desc').textContent = desc;
      const pr = $('#p-prov'); pr.textContent = (PROV[lang] || PROV.en)[prov]; pr.classList.toggle('agent', prov === 'agent');
      $$('.p-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.pl === l));
      product.classList.remove('swap');
    }, calm ? 0 : 230);
  }
  if (product) {
    $$('.p-tabs button').forEach((b) => b.addEventListener('click', () => { manual = true; clearInterval(plTimer); setProduct(b.dataset.pl); }));
    new IntersectionObserver(([e]) => {
      clearInterval(plTimer);
      if (e.isIntersecting && !manual && !calm) plTimer = setInterval(() => { const order = ['de', 'fr', 'it', 'en']; setProduct(order[(order.indexOf(pl) + 1) % 4]); }, 2600);
    }, { threshold: 0.5 }).observe(product);
    onLang.push(() => setProduct(pl));
  }

  /* ---------------------------------------------------------------- approvals card */
  const req = $('#req');
  if (req) {
    let auto = null;
    const approve = () => { req.classList.add('done'); clearTimeout(auto); setTimeout(() => req.classList.remove('done'), 3200); };
    $('.yes', req).addEventListener('click', approve);
    $('.no', req).addEventListener('click', () => { req.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 320 }); });
    new IntersectionObserver(([e], o) => { if (e.isIntersecting) { auto = setTimeout(approve, 2400); o.disconnect(); } }, { threshold: 0.7 }).observe(req);
  }

  /* ---------------------------------------------------------------- any shop: the agent reads a website, a person confirms */
  const stage = $('.any-stage');
  if (stage) {
    const tiles = $$('.tile', stage), rows = $$('.any-queue li', stage), cnt = $('.q-count', stage);
    let anyRun = 0, anyVisible = false, anyStarted = false;
    const setCount = (n) => { cnt.textContent = n ? String(n) : '✓'; cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); };
    const finalState = () => { tiles.forEach((t) => t.classList.add('read')); rows.forEach((r) => r.classList.add('in', 'ok-on')); stage.classList.add('live'); cnt.textContent = '✓'; };
    async function anyLoop() {
      const me = ++anyRun;
      for (;;) {
        stage.classList.remove('scanning', 'flowing', 'ask', 'live');
        tiles.forEach((t) => t.classList.remove('read')); rows.forEach((r) => r.classList.remove('in', 'ok-on')); cnt.textContent = '0';
        await wait(800); if (me !== anyRun) return;
        stage.classList.add('scanning', 'flowing');
        for (let i = 0; i < tiles.length; i++) {
          await wait(560); if (me !== anyRun) return;
          tiles[i].classList.add('read');
          await wait(420); if (me !== anyRun) return;
          rows[i].classList.add('in'); setCount(i + 1);
        }
        stage.classList.remove('flowing');
        await wait(500); stage.classList.add('ask');
        await wait(1700); if (me !== anyRun) return;
        for (const r of rows) { r.classList.add('ok-on'); await wait(150); }
        stage.classList.remove('ask', 'scanning'); stage.classList.add('live'); setCount(0);
        await wait(3400); if (me !== anyRun) return;
        while (!anyVisible && me === anyRun) await wait(800);
      }
    }
    new IntersectionObserver(([e]) => {
      anyVisible = e.isIntersecting;
      if (anyVisible && !anyStarted) { anyStarted = true; if (calm) finalState(); else anyLoop(); }
    }, { threshold: 0.3 }).observe(stage);
  }

  /* ---------------------------------------------------------------- Get started: checklist, sticky rail, mock screens */
  const gsteps = $$('.gstep');
  if (gsteps.length) {
    const KEY = 'mt-start-done', total = gsteps.length;
    let done = new Set();
    try { const saved = JSON.parse(store.get(KEY) || '[]'); if (Array.isArray(saved)) done = new Set(saved.map(Number).filter((n) => n >= 1 && n <= total)); } catch { done = new Set(); }
    const ring = $('.ring-fg'), count = $('#done-n'), next = $('.next-up'), nextTitle = $('#next-title');
    const paint = () => {
      gsteps.forEach((li) => {
        const on = done.has(Number(li.dataset.step));
        li.classList.toggle('is-done', on);
        const b = $('.done-btn', li); if (b) b.setAttribute('aria-pressed', String(on));
      });
      $$('[data-step-link]').forEach((a) => a.classList.toggle('is-done', done.has(Number(a.dataset.stepLink))));
      if (count) count.textContent = String(done.size);
      if (ring) ring.style.strokeDashoffset = String(100 - (done.size / total) * 100);
      const first = gsteps.find((li) => !done.has(Number(li.dataset.step)));
      if (next) {
        next.classList.toggle('all', !first);
        next.setAttribute('href', first ? `#${first.id}` : '#finish');
        if (first && nextTitle) nextTitle.textContent = $('h3', first).textContent;
      }
      document.body.classList.toggle('all-done', !first);
    };
    const burst = (btn) => {
      if (calm) return;
      const colors = ['#ff4d1a', '#ff7a2e', '#ffb45c', '#1f9d63', '#3ccf8e'];
      for (let i = 0; i < 14; i++) {
        const sp = document.createElement('span'), a = (i / 14) * Math.PI * 2, r = 24 + (i % 3) * 12;
        sp.className = 'spark-burst';
        sp.style.setProperty('--dx', `${Math.cos(a) * r}px`); sp.style.setProperty('--dy', `${Math.sin(a) * r}px`); sp.style.setProperty('--c', colors[i % colors.length]);
        btn.appendChild(sp); setTimeout(() => sp.remove(), 900);
      }
    };
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.done-btn');
      if (!b) return;
      const n = Number(b.dataset.done);
      if (done.has(n)) done.delete(n); else { done.add(n); burst(b); }
      store.set(KEY, JSON.stringify([...done].sort((x, y) => x - y)));
      paint();
    });
    onLang.push(paint);
    // "Already have both accounts?" ticks steps 1 and 2 and jumps to the database step.
    const fast = $('[data-fast-lane]');
    if (fast) fast.addEventListener('click', () => {
      done.add(1); done.add(2); store.set(KEY, JSON.stringify([...done].sort((x, y) => x - y))); paint();
      const s3 = $('#step-3'); if (s3) s3.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });

    // The step in the middle of the screen lights up in the rail; the rail line fills to it.
    const rail = $('.rail'), railLinks = $$('.rail [data-step-link]');
    const activate = (n) => {
      railLinks.forEach((a) => { const on = Number(a.dataset.stepLink) === n; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
      gsteps.forEach((li) => li.classList.toggle('current', Number(li.dataset.step) === n));
      if (rail) rail.style.setProperty('--p', String((n - 1) / (total - 1)));
    };
    const railIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) activate(Number(e.target.dataset.step)); }), { rootMargin: '-38% 0px -58% 0px' });
    gsteps.forEach((li) => railIO.observe(li));

    // Mock screens play once when they scroll into view: fields type themselves, then the button lights up.
    const playMock = async (mock) => {
      mock.classList.add('play');
      const fields = $$('.typed', mock);
      fields.forEach((el) => { el.textContent = ''; });
      for (const el of fields) {
        const text = el.dataset.type || '';
        el.classList.add('typing');
        for (let i = 1; i <= text.length; i++) { el.textContent = text.slice(0, i); await wait(text.length > 30 ? 16 : 40); }
        el.classList.remove('typing');
        await wait(150);
      }
      mock.classList.add('ready');
    };
    const mockIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { mockIO.unobserve(e.target); playMock(e.target); } }), { threshold: 0.45 });
    $$('.mock').forEach((m) => mockIO.observe(m));
  }

  /* ---------------------------------------------------------------- real screenshots: one at a time, chips jump, click to enlarge */
  $$('[data-shots]').forEach((fig) => {
    const shots = $$('.shot', fig), tabs = $$('.shots-tab', fig);
    let at = 0;
    const go = (i) => {
      at = (i + shots.length) % shots.length;
      shots.forEach((s, k) => s.classList.toggle('on', k === at));
      tabs.forEach((t, k) => { t.classList.toggle('on', k === at); t.setAttribute('aria-pressed', String(k === at)); });
      const step = fig.closest('.gstep');
      if (step) $$('.shot-link', step).forEach((c) => c.classList.toggle('on', Number(c.dataset.shot) === at + 1));
    };
    fig.goShot = go;
    tabs.forEach((t) => t.addEventListener('click', () => go(Number(t.dataset.go) - 1)));
    const prev = $('.shots-prev', fig), next = $('.shots-next', fig);
    if (prev) prev.addEventListener('click', () => go(at - 1));
    if (next) next.addEventListener('click', () => go(at + 1));
    go(0);
  });
  document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('.shot-link');
    if (!chip) return;
    const fig = chip.closest('.gstep') && $('[data-shots]', chip.closest('.gstep'));
    if (!fig || !fig.goShot) return;
    fig.goShot(Number(chip.dataset.shot) - 1);
    const r = fig.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight) fig.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  });
  let box = null;
  document.addEventListener('click', (e) => {
    const z = e.target.closest && e.target.closest('[data-zoom]');
    if (!z) return;
    const img = $('img', z);
    if (!img || typeof HTMLDialogElement !== 'function') return;
    if (!box) {
      box = document.createElement('dialog'); box.className = 'lightbox';
      box.innerHTML = '<img alt=""><button type="button" aria-label="Close">×</button>';
      box.addEventListener('click', () => box.close());
      document.body.appendChild(box);
    }
    $('img', box).src = img.currentSrc || img.src;
    box.showModal();
  });
  // Screenshots of our own pages follow the visitor's language.
  const langImgs = $$('[data-lang-src]');
  if (langImgs.length) onLang.push((l) => langImgs.forEach((im) => { im.src = im.dataset.langSrc.replace('{lang}', l); }));

  /* ---------------------------------------------------------------- copy buttons (Get started page) */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-copy]');
    if (!btn) return;
    const el = document.getElementById(btn.dataset.copy);
    if (!el || !navigator.clipboard) return;
    navigator.clipboard.writeText(el.textContent.trim()).then(() => {
      btn.textContent = (T[lang] || {}).copied || EN.copied || 'Copied ✓';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = (T[lang] || {}).copy || EN.copy || 'Copy'; btn.classList.remove('done'); }, 1600);
    }).catch(() => {});
  });

  /* ---------------------------------------------------------------- spotlight + magnetic buttons */
  if (!calm) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('.spot');
      if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', `${e.clientX - r.left}px`); card.style.setProperty('--my', `${e.clientY - r.top}px`); }
    }, { passive: true });
    $$('.magnetic').forEach((b) => {
      b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.setProperty('--bx', `${(e.clientX - r.left - r.width / 2) * 0.22}px`); b.style.setProperty('--by', `${(e.clientY - r.top - r.height / 2) * 0.32}px`); });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--bx', '0px'); b.style.setProperty('--by', '0px'); });
    });
  }

  setLang(initial);
})();
