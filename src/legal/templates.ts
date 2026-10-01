// Built-in legal pages for a merchant's trade portal: general terms for trade customers (B2B),
// privacy notice (Swiss FADP / EU GDPR) and legal notice (imprint), in DE / FR / IT / EN.
// They are filled from the shop's own identity and settings so they always match how the portal
// actually works (payment terms, minimum order, approval amount, cancel window, VAT registration).
// TEMPLATES, NOT LEGAL ADVICE: the owner sees that note and can link their own pages instead.

import type { Lang } from '../i18n';
import { formatMoney } from '../money/format';

export const TEMPLATE_VERSION = 'template-2026-09';

export interface LegalVars {
  shop: string; street: string; postcode: string; city: string; email: string;
  uid: string | null; vatRegistered: boolean;
  paymentDays: number; minOrderRappen: number; cancelMinutes: number; approvalRappen: number | null;
  emailProvider: string | null;
}
export interface LegalDoc { title: string; intro?: string; sections: { h: string; p: string[] }[] }
export type LegalKind = 'terms' | 'privacy' | 'imprint';

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export function legalDoc(kind: LegalKind, lang: Lang, v: LegalVars): LegalDoc {
  const money = (r: number) => formatMoney(r, lang);
  const address = `${v.street}, ${v.postcode} ${v.city}`;
  const vars = { shop: v.shop, city: v.city, email: v.email, address, days: v.paymentDays, min: money(v.minOrderRappen), n: v.cancelMinutes,
    amount: v.approvalRappen ? money(v.approvalRappen) : '', provider: v.emailProvider ?? '' };
  const L = TEXT[lang];
  if (kind === 'imprint') {
    const vatSuffix = { de: 'MWST', fr: 'TVA', it: 'IVA', en: 'VAT' }[lang];
    return {
      title: L.imprint.title,
      sections: [
        { h: L.imprint.company, p: [v.shop, v.street, `${v.postcode} ${v.city}`, L.imprint.country] },
        { h: L.imprint.contact, p: [`${L.imprint.email}: ${v.email}`, ...(v.uid ? [`UID: ${v.uid}${v.vatRegistered ? ` ${vatSuffix}` : ''}`] : [])] },
        { h: L.imprint.software, p: [L.imprint.softwareText] },
      ],
    };
  }
  const doc = kind === 'terms' ? L.terms : L.privacy;
  const cancel = v.cancelMinutes > 0 ? L.terms.cancel : '';
  const approval = v.approvalRappen === null ? '' : v.approvalRappen === 0 ? L.terms.approvalAll : L.terms.approvalOver;
  const extra: Record<string, string> = {
    vat: fill(v.vatRegistered ? L.terms.vatYes : L.terms.vatNo, vars),
    cancel: fill(cancel, vars), approval: fill(approval, vars),
    emailLine: v.emailProvider ? fill(L.privacy.emailLine, vars) : '',
  };
  const all = { ...vars, ...extra };
  return {
    title: doc.title,
    intro: fill(doc.intro, all),
    sections: doc.sections.map(([h, ...p]) => ({ h, p: p.map((x) => fill(x, all).replace(/\s{2,}/g, ' ').trim()) })),
  };
}

type Sections = [string, ...string[]][];
interface LangText {
  terms: { title: string; intro: string; vatYes: string; vatNo: string; cancel: string; approvalAll: string; approvalOver: string; sections: Sections };
  privacy: { title: string; intro: string; emailLine: string; sections: Sections };
  imprint: { title: string; company: string; country: string; contact: string; email: string; software: string; softwareText: string };
}

const TEXT: Record<Lang, LangText> = {
  en: {
    terms: {
      title: 'General terms for trade customers',
      intro: 'These terms apply to all orders that business customers place through the {shop} trade portal.',
      vatYes: 'Swiss VAT is added at the applicable rate and shown separately on the invoice.',
      vatNo: '{shop} is not registered for Swiss VAT; no VAT is charged.',
      cancel: 'You can cancel an order within {n} minutes of placing it, as long as it has not been confirmed.',
      approvalAll: 'Every order is reviewed by {shop} and may be declined.',
      approvalOver: 'Orders above {amount} net are reviewed by {shop} and may be declined.',
      sections: [
        ['1. Scope', 'The trade portal is only for businesses (for example retailers, hotels, pharmacies and drugstores). By applying or ordering you confirm that you act as a business, not as a consumer. Different terms apply only if agreed in writing.'],
        ['2. Trade account', '{shop} decides whether to open a trade account and may close it at any time. Keep your sign-in links private and tell us promptly about changes to your company details.'],
        ['3. Prices', 'The trade prices shown in the portal apply, in Swiss francs, net of VAT, according to your price tier. {vat} The price at the time of your order applies.'],
        ['4. Orders and contract', 'Your order is an offer; the contract is concluded when {shop} confirms it. The minimum order value is {min} net. {cancel} {approval}'],
        ['5. Delivery and pickup', 'Goods are delivered to the address you give in Switzerland, or picked up, as chosen when ordering. Delivery dates are estimates. Benefit and risk pass to you when the goods are handed over to you or to the carrier.'],
        ['6. Invoice and payment', 'Every confirmed order is invoiced with a Swiss QR-bill, payable without deduction within {days} days of the invoice date unless other terms are agreed for your account. If you pay late, {shop} may charge default interest of 5 % a year (art. 104 CO) and hold back further deliveries.'],
        ['7. Inspection and defects', 'Check the goods on receipt and report visible defects in writing within 8 days, hidden defects as soon as you discover them (art. 201 CO). For justified complaints {shop} will, at its choice, replace the goods, credit the price or take them back. Further warranty claims are excluded as far as the law permits.'],
        ['8. Liability', '{shop} is liable for damage caused intentionally or through gross negligence. Liability for slight negligence, indirect and consequential damage and lost profit is excluded as far as the law permits.'],
        ['9. Data protection', '{shop} processes your personal data as described in the privacy notice.'],
        ['10. Changes', '{shop} may change these terms. The version valid at the time of your order applies.'],
        ['11. Law and jurisdiction', 'Swiss law applies, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). Place of jurisdiction is {city}.'],
      ],
    },
    privacy: {
      title: 'Privacy notice',
      intro: 'This notice explains how {shop} processes personal data in its trade portal, in line with the Swiss Federal Act on Data Protection (FADP) and, where it applies, the EU General Data Protection Regulation (GDPR).',
      emailLine: 'Emails are sent via {provider}. ',
      sections: [
        ['Who is responsible', '{shop}, {address}. Contact for data protection: {email}.'],
        ['What we process', 'The company and contact details from your application (company, contact person, email, phone, address, UID number), your orders, invoices and payments, and your language. When you use the portal, our hosting provider technically processes data such as your IP address, the time and the pages requested.'],
        ['Why', 'To review applications, run your trade account, process and deliver orders, issue invoices, handle payments and complaints, and meet legal duties such as bookkeeping. Legal basis: our contract with you, our legitimate interest in running our business, and legal obligations.'],
        ['Who helps us', 'The portal runs on Cloudflare (hosting and database; data stored in the EU). {emailLine}{shop} may use an AI assistant to help run the portal (for example to prepare approvals); it acts only on our instructions and never decides on your account or orders by itself.'],
        ['Transfers abroad', 'Some of these providers may process data outside Switzerland and the EU/EEA, for example in the USA. We then rely on Swiss and EU adequacy decisions (for example the Swiss-US Data Privacy Framework) or on standard contractual clauses.'],
        ['How long we keep data', 'We keep your account data while your account is active. Invoices and bookkeeping records are kept for 10 years, as Swiss law requires (art. 958f CO).'],
        ['Cookies', 'The portal only uses necessary cookies: one keeps you signed in, one remembers your language. No tracking or advertising cookies.'],
        ['Your rights', 'You can ask for access to your data, have it corrected or deleted, object to processing, and receive your data in a common format. Write to {email}. You can also complain to the Swiss Federal Data Protection and Information Commissioner (FDPIC) or, in the EU, to your data protection authority.'],
        ['Changes', 'We may update this notice. The current version is always published here.'],
      ],
    },
    imprint: { title: 'Legal notice', company: 'Company', country: 'Switzerland', contact: 'Contact', email: 'Email', software: 'Trade portal software', softwareText: 'This trade portal runs on MoltenRock Trade.' },
  },
  de: {
    terms: {
      title: 'Allgemeine Geschäftsbedingungen für Geschäftskunden',
      intro: 'Diese Bedingungen gelten für alle Bestellungen, die Geschäftskunden über das Handelsportal von {shop} aufgeben.',
      vatYes: 'Die Mehrwertsteuer (MWST) wird zum geltenden Satz hinzugerechnet und auf der Rechnung separat ausgewiesen.',
      vatNo: '{shop} ist nicht mehrwertsteuerpflichtig; es wird keine MWST berechnet.',
      cancel: 'Sie können eine Bestellung innert {n} Minuten nach dem Absenden stornieren, solange sie noch nicht bestätigt ist.',
      approvalAll: 'Jede Bestellung wird von {shop} geprüft und kann abgelehnt werden.',
      approvalOver: 'Bestellungen über {amount} netto werden von {shop} geprüft und können abgelehnt werden.',
      sections: [
        ['1. Geltungsbereich', 'Das Handelsportal steht nur Unternehmen offen (zum Beispiel Handel, Hotellerie, Apotheken und Drogerien). Mit der Anmeldung oder Bestellung bestätigen Sie, dass Sie als Unternehmen und nicht als Konsument handeln. Abweichende Bedingungen gelten nur, wenn sie schriftlich vereinbart sind.'],
        ['2. Handelskonto', '{shop} entscheidet über die Eröffnung eines Handelskontos und kann es jederzeit schliessen. Halten Sie Ihre Anmeldelinks vertraulich und melden Sie Änderungen Ihrer Firmendaten umgehend.'],
        ['3. Preise', 'Es gelten die im Portal angezeigten Handelspreise in Schweizer Franken, netto ohne Mehrwertsteuer, gemäss Ihrer Preisstufe. {vat} Massgebend ist der Preis zum Zeitpunkt der Bestellung.'],
        ['4. Bestellung und Vertragsschluss', 'Ihre Bestellung ist ein Angebot; der Vertrag kommt mit der Bestätigung durch {shop} zustande. Der Mindestbestellwert beträgt {min} netto. {cancel} {approval}'],
        ['5. Lieferung und Abholung', 'Geliefert wird an die angegebene Adresse in der Schweiz, oder die Ware wird abgeholt – wie beim Bestellen gewählt. Liefertermine sind Richtwerte. Nutzen und Gefahr gehen mit der Übergabe an Sie oder an das Transportunternehmen auf Sie über.'],
        ['6. Rechnung und Zahlung', 'Für jede bestätigte Bestellung erhalten Sie eine Schweizer QR-Rechnung, zahlbar innert {days} Tagen ab Rechnungsdatum ohne Abzug, sofern für Ihr Konto nichts anderes vereinbart ist. Bei Zahlungsverzug kann {shop} einen Verzugszins von 5 % pro Jahr verlangen (Art. 104 OR) und weitere Lieferungen zurückhalten.'],
        ['7. Prüfung und Mängel', 'Prüfen Sie die Ware bei Erhalt und melden Sie sichtbare Mängel innert 8 Tagen schriftlich, versteckte Mängel sofort nach ihrer Entdeckung (Art. 201 OR). Bei berechtigten Beanstandungen ersetzt {shop} nach eigener Wahl die Ware, schreibt den Preis gut oder nimmt sie zurück. Weitergehende Gewährleistungsansprüche sind ausgeschlossen, soweit gesetzlich zulässig.'],
        ['8. Haftung', '{shop} haftet für Schäden, die absichtlich oder grobfahrlässig verursacht wurden. Die Haftung für leichte Fahrlässigkeit, indirekte Schäden, Folgeschäden und entgangenen Gewinn ist ausgeschlossen, soweit gesetzlich zulässig.'],
        ['9. Datenschutz', '{shop} bearbeitet Ihre Personendaten gemäss der Datenschutzerklärung.'],
        ['10. Änderungen', '{shop} kann diese Bedingungen ändern. Es gilt die bei Ihrer Bestellung gültige Fassung.'],
        ['11. Anwendbares Recht und Gerichtsstand', 'Es gilt schweizerisches Recht unter Ausschluss des Wiener Kaufrechts (CISG). Gerichtsstand ist {city}.'],
      ],
    },
    privacy: {
      title: 'Datenschutzerklärung',
      intro: 'Diese Erklärung beschreibt, wie {shop} im Handelsportal Personendaten bearbeitet – gemäss dem Schweizer Datenschutzgesetz (DSG) und, soweit anwendbar, der EU-Datenschutz-Grundverordnung (DSGVO).',
      emailLine: 'E-Mails werden über {provider} versendet. ',
      sections: [
        ['Verantwortlich', '{shop}, {address}. Kontakt für Datenschutzfragen: {email}.'],
        ['Welche Daten', 'Die Firmen- und Kontaktangaben aus Ihrer Anmeldung (Firma, Ansprechperson, E-Mail, Telefon, Adresse, UID-Nummer), Ihre Bestellungen, Rechnungen und Zahlungen sowie Ihre Sprache. Bei der Nutzung des Portals bearbeitet unser Hostinganbieter technisch bedingt Daten wie IP-Adresse, Zeitpunkt und aufgerufene Seiten.'],
        ['Wozu', 'Um Anmeldungen zu prüfen, Ihr Handelskonto zu führen, Bestellungen abzuwickeln und zu liefern, Rechnungen zu stellen, Zahlungen und Beanstandungen zu bearbeiten und gesetzliche Pflichten wie die Buchführung zu erfüllen. Rechtsgrundlagen: der Vertrag mit Ihnen, unser berechtigtes Interesse am Geschäftsbetrieb und gesetzliche Pflichten.'],
        ['Wer uns hilft', 'Das Portal läuft bei Cloudflare (Hosting und Datenbank; Speicherung in der EU). {emailLine}{shop} kann einen KI-Assistenten für den Betrieb des Portals einsetzen (zum Beispiel, um Freigaben vorzubereiten); er handelt nur nach unseren Anweisungen und entscheidet nie selbst über Ihr Konto oder Ihre Bestellungen.'],
        ['Bekanntgabe ins Ausland', 'Einige dieser Anbieter können Daten ausserhalb der Schweiz und des EWR bearbeiten, etwa in den USA. Wir stützen uns dann auf Angemessenheitsentscheide der Schweiz und der EU (zum Beispiel das Swiss-US Data Privacy Framework) oder auf Standardvertragsklauseln.'],
        ['Aufbewahrung', 'Kontodaten bewahren wir auf, solange Ihr Konto aktiv ist. Rechnungen und Buchhaltungsunterlagen bewahren wir gemäss Gesetz 10 Jahre auf (Art. 958f OR).'],
        ['Cookies', 'Das Portal verwendet nur notwendige Cookies: eines hält Sie angemeldet, eines merkt sich Ihre Sprache. Keine Tracking- oder Werbe-Cookies.'],
        ['Ihre Rechte', 'Sie können Auskunft über Ihre Daten verlangen, sie berichtigen oder löschen lassen, der Bearbeitung widersprechen und Ihre Daten in einem gängigen Format erhalten. Schreiben Sie an {email}. Sie können sich zudem beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) oder, in der EU, bei Ihrer Datenschutzbehörde beschweren.'],
        ['Änderungen', 'Wir können diese Erklärung anpassen. Die aktuelle Fassung ist immer hier veröffentlicht.'],
      ],
    },
    imprint: { title: 'Impressum', company: 'Firma', country: 'Schweiz', contact: 'Kontakt', email: 'E-Mail', software: 'Software des Handelsportals', softwareText: 'Dieses Handelsportal läuft mit MoltenRock Trade.' },
  },
  fr: {
    terms: {
      title: 'Conditions générales pour les clients professionnels',
      intro: 'Ces conditions s’appliquent à toutes les commandes passées par des clients professionnels sur le portail professionnel de {shop}.',
      vatYes: 'La TVA est ajoutée au taux applicable et indiquée séparément sur la facture.',
      vatNo: '{shop} n’est pas assujetti à la TVA ; aucune TVA n’est facturée.',
      cancel: 'Vous pouvez annuler une commande dans les {n} minutes suivant son envoi, tant qu’elle n’est pas confirmée.',
      approvalAll: 'Chaque commande est vérifiée par {shop} et peut être refusée.',
      approvalOver: 'Les commandes de plus de {amount} net sont vérifiées par {shop} et peuvent être refusées.',
      sections: [
        ['1. Champ d’application', 'Le portail est réservé aux entreprises (par exemple commerce, hôtellerie, pharmacies et drogueries). En vous inscrivant ou en commandant, vous confirmez agir en tant qu’entreprise et non en tant que consommateur. Des conditions différentes ne s’appliquent que si elles ont été convenues par écrit.'],
        ['2. Compte professionnel', '{shop} décide de l’ouverture d’un compte professionnel et peut le fermer à tout moment. Gardez vos liens de connexion confidentiels et signalez sans délai tout changement des données de votre entreprise.'],
        ['3. Prix', 'Les prix professionnels affichés sur le portail s’appliquent, en francs suisses, nets hors TVA, selon votre niveau de prix. {vat} Le prix valable au moment de la commande fait foi.'],
        ['4. Commande et conclusion du contrat', 'Votre commande constitue une offre ; le contrat est conclu avec la confirmation de {shop}. La valeur minimale de commande est de {min} net. {cancel} {approval}'],
        ['5. Livraison et retrait', 'La marchandise est livrée à l’adresse indiquée en Suisse ou retirée, selon le choix fait lors de la commande. Les délais de livraison sont indicatifs. Les profits et les risques passent à vous lors de la remise à vous-même ou au transporteur.'],
        ['6. Facture et paiement', 'Chaque commande confirmée fait l’objet d’une facture QR suisse, payable sans déduction dans les {days} jours suivant la date de facture, sauf accord différent pour votre compte. En cas de retard, {shop} peut exiger un intérêt moratoire de 5 % par an (art. 104 CO) et suspendre les livraisons.'],
        ['7. Vérification et défauts', 'Vérifiez la marchandise à réception et signalez par écrit les défauts apparents dans les 8 jours, les défauts cachés dès leur découverte (art. 201 CO). En cas de réclamation justifiée, {shop} remplace la marchandise, crédite le prix ou la reprend, à son choix. Toute autre garantie est exclue dans la mesure permise par la loi.'],
        ['8. Responsabilité', '{shop} répond des dommages causés intentionnellement ou par négligence grave. La responsabilité pour négligence légère, dommages indirects, dommages consécutifs et gain manqué est exclue dans la mesure permise par la loi.'],
        ['9. Protection des données', '{shop} traite vos données personnelles conformément à la déclaration de protection des données.'],
        ['10. Modifications', '{shop} peut modifier ces conditions. La version en vigueur au moment de votre commande s’applique.'],
        ['11. Droit applicable et for', 'Le droit suisse s’applique, à l’exclusion de la Convention de Vienne sur la vente internationale de marchandises (CVIM). Le for est à {city}.'],
      ],
    },
    privacy: {
      title: 'Déclaration de protection des données',
      intro: 'Cette déclaration explique comment {shop} traite des données personnelles dans son portail professionnel, conformément à la loi fédérale sur la protection des données (LPD) et, lorsqu’il s’applique, au règlement général de l’UE sur la protection des données (RGPD).',
      emailLine: 'Les e-mails sont envoyés via {provider}. ',
      sections: [
        ['Responsable', '{shop}, {address}. Contact pour la protection des données : {email}.'],
        ['Données traitées', 'Les données de l’entreprise et de contact issues de votre inscription (entreprise, personne de contact, e-mail, téléphone, adresse, numéro IDE), vos commandes, factures et paiements ainsi que votre langue. Lors de l’utilisation du portail, notre hébergeur traite pour des raisons techniques des données telles que l’adresse IP, l’heure et les pages consultées.'],
        ['Finalités', 'Examiner les inscriptions, gérer votre compte professionnel, traiter et livrer les commandes, établir les factures, traiter les paiements et les réclamations et respecter nos obligations légales, comme la comptabilité. Bases juridiques : notre contrat avec vous, notre intérêt légitime à exploiter notre entreprise et nos obligations légales.'],
        ['Qui nous aide', 'Le portail fonctionne sur Cloudflare (hébergement et base de données ; données stockées dans l’UE). {emailLine}{shop} peut utiliser un assistant IA pour exploiter le portail (par exemple pour préparer des validations) ; il agit uniquement sur nos instructions et ne décide jamais seul de votre compte ou de vos commandes.'],
        ['Communication à l’étranger', 'Certains de ces prestataires peuvent traiter des données hors de Suisse et de l’EEE, par exemple aux États-Unis. Nous nous fondons alors sur les décisions d’adéquation de la Suisse et de l’UE (par exemple le Swiss-US Data Privacy Framework) ou sur des clauses contractuelles types.'],
        ['Conservation', 'Nous conservons les données de votre compte tant qu’il est actif. Les factures et pièces comptables sont conservées 10 ans, comme l’exige la loi (art. 958f CO).'],
        ['Cookies', 'Le portail n’utilise que des cookies nécessaires : l’un vous garde connecté, l’autre mémorise votre langue. Aucun cookie de suivi ou publicitaire.'],
        ['Vos droits', 'Vous pouvez demander l’accès à vos données, leur rectification ou leur effacement, vous opposer au traitement et recevoir vos données dans un format courant. Écrivez à {email}. Vous pouvez aussi vous adresser au Préposé fédéral à la protection des données et à la transparence (PFPDT) ou, dans l’UE, à votre autorité de protection des données.'],
        ['Modifications', 'Nous pouvons adapter cette déclaration. La version actuelle est toujours publiée ici.'],
      ],
    },
    imprint: { title: 'Mentions légales', company: 'Entreprise', country: 'Suisse', contact: 'Contact', email: 'E-mail', software: 'Logiciel du portail', softwareText: 'Ce portail professionnel fonctionne avec MoltenRock Trade.' },
  },
  it: {
    terms: {
      title: 'Condizioni generali per i clienti commerciali',
      intro: 'Queste condizioni valgono per tutti gli ordini effettuati da clienti commerciali tramite il portale per rivenditori di {shop}.',
      vatYes: 'L’IVA è aggiunta all’aliquota applicabile e indicata separatamente in fattura.',
      vatNo: '{shop} non è assoggettato all’IVA; non viene addebitata alcuna IVA.',
      cancel: 'Può annullare un ordine entro {n} minuti dall’invio, finché non è confermato.',
      approvalAll: 'Ogni ordine è verificato da {shop} e può essere rifiutato.',
      approvalOver: 'Gli ordini superiori a {amount} netto sono verificati da {shop} e possono essere rifiutati.',
      sections: [
        ['1. Campo d’applicazione', 'Il portale è riservato alle aziende (per esempio commercio, settore alberghiero, farmacie e drogherie). Registrandosi o ordinando conferma di agire come azienda e non come consumatore. Condizioni diverse valgono solo se concordate per iscritto.'],
        ['2. Conto commerciale', '{shop} decide sull’apertura di un conto commerciale e può chiuderlo in qualsiasi momento. Mantenga riservati i link di accesso e comunichi senza indugio le modifiche dei dati aziendali.'],
        ['3. Prezzi', 'Valgono i prezzi commerciali indicati nel portale, in franchi svizzeri, netti senza IVA, secondo il suo livello di prezzo. {vat} Fa stato il prezzo al momento dell’ordine.'],
        ['4. Ordine e conclusione del contratto', 'Il suo ordine è un’offerta; il contratto è concluso con la conferma di {shop}. Il valore minimo d’ordine è di {min} netto. {cancel} {approval}'],
        ['5. Consegna e ritiro', 'La merce è consegnata all’indirizzo indicato in Svizzera o ritirata, secondo la scelta fatta al momento dell’ordine. I termini di consegna sono indicativi. Utili e rischi passano a lei con la consegna a lei o al trasportatore.'],
        ['6. Fattura e pagamento', 'Per ogni ordine confermato riceve una fattura QR svizzera, pagabile senza deduzioni entro {days} giorni dalla data della fattura, salvo accordi diversi per il suo conto. In caso di ritardo {shop} può chiedere un interesse di mora del 5 % annuo (art. 104 CO) e sospendere le consegne.'],
        ['7. Verifica e difetti', 'Verifichi la merce al ricevimento e segnali per iscritto i difetti visibili entro 8 giorni, quelli occulti subito dopo la scoperta (art. 201 CO). In caso di reclamo giustificato {shop} sostituisce la merce, accredita il prezzo o la riprende, a sua scelta. Ulteriori pretese di garanzia sono escluse nella misura consentita dalla legge.'],
        ['8. Responsabilità', '{shop} risponde dei danni causati intenzionalmente o per negligenza grave. La responsabilità per negligenza lieve, danni indiretti, danni conseguenti e lucro cessante è esclusa nella misura consentita dalla legge.'],
        ['9. Protezione dei dati', '{shop} tratta i suoi dati personali secondo l’informativa sulla protezione dei dati.'],
        ['10. Modifiche', '{shop} può modificare queste condizioni. Vale la versione in vigore al momento dell’ordine.'],
        ['11. Diritto applicabile e foro', 'Si applica il diritto svizzero, esclusa la Convenzione di Vienna sulla vendita internazionale di merci (CISG). Il foro competente è {city}.'],
      ],
    },
    privacy: {
      title: 'Informativa sulla protezione dei dati',
      intro: 'Questa informativa spiega come {shop} tratta i dati personali nel suo portale per rivenditori, secondo la legge federale sulla protezione dei dati (LPD) e, se applicabile, il regolamento generale UE sulla protezione dei dati (RGPD).',
      emailLine: 'Le e-mail sono inviate tramite {provider}. ',
      sections: [
        ['Titolare', '{shop}, {address}. Contatto per la protezione dei dati: {email}.'],
        ['Dati trattati', 'I dati aziendali e di contatto della sua registrazione (azienda, persona di contatto, e-mail, telefono, indirizzo, numero IDI), i suoi ordini, fatture e pagamenti e la sua lingua. Durante l’uso del portale il nostro fornitore di hosting tratta per motivi tecnici dati come indirizzo IP, ora e pagine visitate.'],
        ['Scopi', 'Verificare le registrazioni, gestire il suo conto commerciale, evadere e consegnare gli ordini, emettere fatture, gestire pagamenti e reclami e adempiere obblighi legali come la contabilità. Basi giuridiche: il contratto con lei, il nostro legittimo interesse a gestire l’attività e gli obblighi legali.'],
        ['Chi ci aiuta', 'Il portale funziona su Cloudflare (hosting e database; dati memorizzati nell’UE). {emailLine}{shop} può usare un assistente IA per gestire il portale (per esempio per preparare approvazioni); agisce solo su nostre istruzioni e non decide mai da solo sul suo conto o sui suoi ordini.'],
        ['Comunicazione all’estero', 'Alcuni di questi fornitori possono trattare dati fuori dalla Svizzera e dallo SEE, per esempio negli Stati Uniti. In tal caso ci basiamo sulle decisioni di adeguatezza della Svizzera e dell’UE (per esempio lo Swiss-US Data Privacy Framework) o su clausole contrattuali standard.'],
        ['Conservazione', 'Conserviamo i dati del conto finché è attivo. Fatture e documenti contabili sono conservati per 10 anni, come richiesto dalla legge (art. 958f CO).'],
        ['Cookie', 'Il portale usa solo cookie necessari: uno la mantiene connesso, uno ricorda la sua lingua. Nessun cookie di tracciamento o pubblicitario.'],
        ['I suoi diritti', 'Può chiedere l’accesso ai suoi dati, la loro rettifica o cancellazione, opporsi al trattamento e ricevere i dati in un formato comune. Scriva a {email}. Può anche rivolgersi all’Incaricato federale della protezione dei dati e della trasparenza (IFPDT) o, nell’UE, alla sua autorità di protezione dei dati.'],
        ['Modifiche', 'Possiamo aggiornare questa informativa. La versione attuale è sempre pubblicata qui.'],
      ],
    },
    imprint: { title: 'Note legali', company: 'Azienda', country: 'Svizzera', contact: 'Contatto', email: 'E-mail', software: 'Software del portale', softwareText: 'Questo portale per rivenditori funziona con MoltenRock Trade.' },
  },
};
