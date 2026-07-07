# Wortschatz

App per memorizzare il vocabolario del Goethe-Zertifikat B1 (poi B2), costruita per Daniela.

- **App:** https://abedd74.github.io/wortschatz/
- 3.299 voci: lista ufficiale Goethe B1 + Redemittel personali
- Ripetizione spaziata (scatole di Leitner), ~15 minuti al giorno
- Smistamento rapido ("la conosco / non la conosco") per parcheggiare il lessico già noto
- Trappole segnalate: falsi amici e generi ingannevoli rispetto all'italiano
- I progressi restano nel browser (localStorage); sincronizzazione cloud opzionale via `ws-sync.js` (Firestore) con link personale `?codice=...` — il codice non va mai committato

## Struttura
- `index.html` — l'app completa (nessuna dipendenza esterna oltre ai font)
- `wortschatz_data.js` — il dizionario, generato da `gen_data.py` nel progetto locale: non modificare a mano
- `ws-sync.js` — sincronizzazione cloud (spenta finché non si compila `CONFIG`)
