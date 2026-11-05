# Draaiboek – QuaKoken

Web-app voor het delen van een draaiboek met klanten. De inhoud staat versleuteld in `content.enc.json`
en is alleen leesbaar met de toegangscode. De actielijst wordt live gedeeld via Firebase Firestore.

Bouwen: `CODE=<toegangscode> node build.mjs` → map `public/` (wordt gepubliceerd op GitHub Pages).

## Meerdere draaiboeken

Elk bruidspaar krijgt een eigen app in `docs/<boek>/` met een eigen toegangscode, eigen kleuren, eigen app-icoon en een eigen gedeelde actielijst.

- Job & Loes: `docs/` (oorspronkelijke app, ongewijzigd)
- Neil & Lotte: `docs/neil-lotte/`

Bouwen: `BOEK=neil-lotte CODE=<toegangscode> node build-boek.mjs`. De leesbare inhoud staat in `src/boeken/<boek>/` en gaat niet in git.
Na het toevoegen van een nieuw draaiboek: publiceer `firestore.rules` opnieuw (Firebase console → Firestore → Regels, of `firebase deploy --only firestore:rules`), anders werkt de actielijst van het nieuwe draaiboek niet.
