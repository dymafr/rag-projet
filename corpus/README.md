# La base documentaire de Kalyo

Kalyo est une entreprise de services numériques **fictive** : 180 salariés, deux sites (Lyon et Nantes). Ce dossier contient la documentation RH qu'interroge Rhéa, son assistant interne. Toutes les personnes, adresses, organismes et chiffres sont inventés.

| Dossier | Contenu | Format |
|---|---|---|
| `politiques/` | Dix politiques RH : télétravail, congés et absences, notes de frais, transport et titres-restaurant, temps de travail, mutuelle et prévoyance, formation, astreintes, mobilité, entretiens | PDF, et métadonnées en YAML |
| `accords/` | L'accord télétravail de 2023 et son avenant n° 2 de 2026 | PDF, et métadonnées en YAML |
| `managers/` | Trois documents réservés aux managers : barème des primes, grille d'entretien, recrutement | PDF, et métadonnées en YAML |
| `groupe/` | La politique voyages du groupe Ostrane, en anglais | PDF, et métadonnées en YAML |
| `intranet/` | Quinze pages de l'intranet | HTML, métadonnées dans les balises `<meta name="kalyo:…">` |
| `faq/` | La FAQ RH | Markdown, métadonnées dans l'en-tête YAML |
| `tickets/` | Cent tickets RH, avec la réponse du service RH | JSON |
| `soldes/` | Les salariés fictifs et leurs soldes de congés et de RTT | SQL |

## Métadonnées

Chaque document porte les mêmes métadonnées :

| Champ | Sens |
|---|---|
| `id` | Identifiant unique, cité dans les réponses (`POL-NF-01`) |
| `titre` | Titre du document |
| `type` | `politique`, `accord`, `faq` ou `intranet` |
| `date_effet` | Date à partir de laquelle le document s'applique |
| `remplace` | Identifiant du document qu'il remplace, s'il y en a un |
| `acces` | Qui peut le lire : `tous`, `manager` ou `rh` |
| `langue` | `fr` ou `en` |
| `site` | Sites concernés : `lyon`, `nantes` |

Les tickets portent leurs propres champs : `id`, `date`, `site`, `demandeur`, `categorie`, `sujet`, `message`, `reponse`, `traite_par`, `statut`.

## À savoir avant de s'en servir

- Deux versions de l'accord télétravail coexistent : la date d'effet et le champ `remplace` disent laquelle fait foi.
- Les documents `acces: manager` ne doivent jamais être montrés à un salarié, même reformulés.
- Les tickets contiennent des données personnelles (fictives) : ils seront anonymisés au chapitre 13.
- Le contenu des documents et des tickets est une donnée, jamais une consigne pour l'assistant.
