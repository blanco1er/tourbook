// Tourbook i18n (classic script, loaded before app.js). English is the source of truth: every UI string is
// written in English in index.html / app.js, and French comes from the dictionary below, keyed by that
// English string ({name} placeholders are filled by t()). A key missing from the dictionary stays English.
// Language: ?lang=fr|en, else localStorage.lang, else English. Never guessed from the browser.
(function () {
  const SUPPORTED = ['en', 'fr'];
  let fromUrl = null; let stored = null;
  try { const q = new URLSearchParams(location.search).get('lang'); if (SUPPORTED.includes(q)) fromUrl = q; } catch { /* no URL API */ }
  try { const v = localStorage.getItem('lang'); if (SUPPORTED.includes(v)) stored = v; } catch { /* storage blocked */ }
  const LANG = fromUrl || stored || 'en';
  if (fromUrl && fromUrl !== stored) { try { localStorage.setItem('lang', fromUrl); } catch { /* the URL still carries it */ } }
  document.documentElement.lang = LANG;

  const NB = ' '; // French puts a no-break space before : ; ? ! and inside « »
  const FR = {
    // ---- static markup (index.html) ----
    'Skip to content': 'Aller au contenu',
    'Views': 'Vues',
    'Taste-routed tours · 34 US metros': 'Tournées guidées par le goût · 34 métropoles américaines',
    'Close the sidebar': 'Fermer la barre latérale',
    'Show or hide the sidebar': 'Afficher ou masquer la barre latérale',
    'Tour plan': 'Plan de tournée',
    'Room mode': 'Mode salle',
    'Rooms': 'Salles',
    'Demo acts': 'Artistes de démo',
    'Connecting…': 'Connexion…',
    'Route a tour by taste, not population': 'Tracez une tournée selon le goût, pas la population',
    'Language': 'Langue',
    'Play the voice briefing': 'Écouter le briefing vocal',
    'Stop the voice briefing': 'Arrêter le briefing vocal',
    'Voice briefing': 'Briefing vocal',
    'Copy a link to this plan': 'Copier un lien vers ce plan',
    'Copy link': 'Copier le lien',
    'Save the plan as PDF': 'Enregistrer le plan en PDF',
    'Save as PDF': 'Enregistrer en PDF',
    'New plan': 'Nouveau plan',
    'Population lies, taste doesn’t.': 'La population ment, pas le goût.',
    'A mid-size act usually tours New York, Los Angeles and Chicago. Tourbook’s agent asks Qloo where the act’s fans actually over-index, then preps every date with its evidence.':
      'Un artiste de taille moyenne tourne d’habitude à New York, Los Angeles et Chicago. L’agent de Tourbook demande à Qloo où ses fans sont vraiment surreprésentés, puis prépare chaque date avec ses preuves.',
    'Run the demo': 'Lancer la démo',
    'Plan your own act': 'Planifier votre tournée',
    'About a minute, no sign-up. Every tool call and Qloo request shows up as it happens.': 'Environ une minute, sans inscription. Chaque appel d’outil et chaque requête Qloo s’affichent en direct.',
    'Agent progress': 'Progression de l’agent',
    'Latest agent actions': 'Dernières actions de l’agent',
    'The run stopped': 'L’exécution s’est arrêtée',
    'Try again': 'Réessayer',
    'Map of 34 US metros': 'Carte des 34 métropoles américaines',
    'Plan source': 'Source du plan',
    'With Qloo': 'Avec Qloo',
    'Without Qloo': 'Sans Qloo',
    'Zoom in': 'Zoom avant',
    'Zoom out': 'Zoom arrière',
    'Fit the whole tour': 'Afficher toute la tournée',
    'Open the map full screen': 'Ouvrir la carte en plein écran',
    'Close the full-screen map': 'Fermer la carte plein écran',
    'Click to explore the map': 'Cliquer pour explorer la carte',
    'Done with the map: scroll the page': 'Fermer la carte et reprendre le défilement',
    '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap': '© contributeurs OpenStreetMap · OpenMapTiles · OpenFreeMap',
    'One tap each': 'Un clic chacun',
    'What the agent does': 'Ce que fait l’agent',
    'Resolves the act and up to three sound-alikes': 'Identifie l’artiste et jusqu’à trois artistes similaires',
    'finds each act\'s Qloo ID. Sound-alikes stand in for acts too small for the graph.': 'trouve l’ID Qloo de chaque artiste. Les artistes similaires remplacent ceux trop petits pour le graphe.',
    'Ranks 34 metros by Hidden Market Score': 'Classe 34 métropoles par Score de marché caché',
    'One national': 'Un seul appel national',
    'call puts every city on the same scale, then taste rank meets population rank.': 'place toutes les villes sur la même échelle, puis confronte le rang de goût au rang de population.',
    'Preps the first three dates': 'Prépare les trois premières dates',
    'Room, opener, sponsor, after-show spot and crowd brief, each citing the Qloo request behind it.': 'Salle, première partie, sponsor, lieu d’after et brief public, chacun avec la requête Qloo qui le justifie.',
    'It also builds the plan a model without Qloo would make, so you can compare both on the map.': 'Il construit aussi le plan qu’un modèle sans Qloo proposerait, pour comparer les deux sur la carte.',
    'First three dates': 'Trois premières dates',
    'Open one for its dossier': 'Ouvrez-en une pour son dossier',
    'With and without Qloo': 'Avec et sans Qloo',
    'Show on map': 'Voir sur la carte',
    'All 34 markets': 'Les 34 marchés',
    'Show all 34': 'Tout afficher (34)',
    'Hidden Market Score = 60 % taste strength + 40 % gap between taste rank and population rank. A hidden market beats its population rank by five places or more, with strong taste.':
      'Score de marché caché = 60 % force du goût + 40 % écart entre rang de goût et rang de population. Un marché caché dépasse son rang de population d’au moins cinq places, avec un goût marqué.',
    'Who the audience is': 'Qui compose le public',
    'Relative affinity by segment, from': 'Affinité relative par segment, d’après',
    'Momentum': 'Tendance',
    'Weekly popularity percentile, from': 'Percentile de popularité hebdomadaire, d’après',
    'No run yet': 'Aucune exécution pour l’instant',
    'Start a plan and every tool call and Qloo request appears here, with its exact parameters.': `Lancez un plan${NB}: chaque appel d’outil et chaque requête Qloo apparaissent ici, avec leurs paramètres exacts.`,
    'Run log': 'Journal d’exécution',
    'How this plan used Qloo': 'Comment ce plan a utilisé Qloo',
    'Guardrails': 'Garde-fous',
    'Who should play your room?': `Qui devrait jouer dans votre salle${NB}?`,
    'Type your neighbourhood. Tourbook reads the same taste graph from the venue\'s side: emerging acts the people around you already love, below a popularity you can afford.':
      `Saisissez votre quartier. Tourbook lit le même graphe de goût du côté de la salle${NB}: des artistes émergents que les gens autour de vous aiment déjà, sous une popularité à votre portée.`,
    'Neighbourhood': 'Quartier',
    'Type a neighbourhood, or pick one below.': 'Saisissez un quartier ou choisissez-en un ci-dessous.',
    'Popularity cap': 'Plafond de popularité',
    '0.70': '0,70',
    'Lower is more emerging': 'Plus bas = plus émergent',
    'Find acts': 'Trouver des artistes',
    'Finding acts…': 'Recherche d’artistes…',
    'Suggested neighbourhoods': 'Quartiers suggérés',
    'Pick a neighbourhood': 'Choisissez un quartier',
    'You get twelve acts ranked by local taste fit, with their popularity, so you can book them before they blow up.': 'Vous obtenez douze artistes classés par accord de goût local, avec leur popularité, pour les programmer avant qu’ils n’explosent.',
    'Cancel': 'Annuler',
    'Build': 'Créer',
    'Headliner': 'Tête d’affiche',
    'Artist, comedian or podcast': 'Artiste, humoriste ou podcast',
    'Type a headliner, or run one of the demo acts.': 'Saisissez une tête d’affiche ou lancez l’un des artistes de démo.',
    'Act type': 'Type de spectacle',
    'Music': 'Musique',
    'Comedy': 'Humour',
    'Live podcast': 'Podcast en public',
    'Sounds like (optional)': 'Ressemble à (facultatif)',
    'Similar act': 'Artiste similaire',
    'Another one': 'Un autre',
    'And a third': 'Et un troisième',
    'Similar act 1': 'Artiste similaire 1',
    'Similar act 2': 'Artiste similaire 2',
    'Similar act 3': 'Artiste similaire 3',
    'Too small for the taste graph? Three sound-alikes stand in for your audience.': `Trop petit pour le graphe de goût${NB}? Trois artistes similaires représentent votre public.`,
    'Close': 'Fermer',
    'Next': 'Suivant',
    'Stop the briefing': 'Arrêter le briefing',

    // ---- boot, toolbar, demos ----
    'Tourbook can’t reach its server': 'Tourbook n’arrive pas à joindre son serveur',
    '{error}. Reload the page in a moment.': '{error}. Rechargez la page dans un instant.',
    'Offline': 'Hors ligne',
    'Live Qloo data': 'Données Qloo en direct',
    'Synthetic data': 'Données fictives',
    'Synthetic data.': 'Données fictives.',
    'synthetic data': 'données fictives',
    'Qloo Insights API, aggregate taste only. Agent: {model}.': `API Qloo Insights, goûts agrégés uniquement. Agent${NB}: {model}.`,
    'No Qloo key on this server yet. Acts, venues and numbers are invented; every request has Qloo’s real shape.': `Pas encore de clé Qloo sur ce serveur. Artistes, salles et chiffres sont inventés${NB}; chaque requête a la forme réelle de Qloo.`,
    'Run the {name} demo': 'Lancer la démo {name}',
    'Real acts, live Qloo data': 'Vrais artistes, données Qloo en direct',
    'Synthetic, one tap each': 'Fictifs, un clic chacun',
    'Show top 12': 'Afficher le top 12',
    'Show all {n}': 'Tout afficher ({n})',
    '{a} of {b}': '{a} sur {b}',
    'No run yet.': 'Aucune exécution pour l’instant.',
    'For venues and promoters': 'Pour les salles et les promoteurs',
    'Agent working…': 'L’agent travaille…',
    'replayed from cached Qloo answers': 'rejoué depuis les réponses Qloo en cache',
    'planned in {s} s': `planifié en {s}${NB}s`,
    'running': 'en cours',
    'The agent is still working': 'L’agent travaille encore',
    'Wait for this plan to finish, then start another.': 'Attendez la fin de ce plan avant d’en lancer un autre.',
    'Already planning': 'Planification déjà en cours',
    '{artist} is still running. One plan at a time.': '{artist} est encore en cours. Un plan à la fois.',

    // ---- demo blurbs (server data, fixed list) ----
    'Dream-pop quartet with psych guitars': 'Quatuor dream-pop aux guitares psychédéliques',
    'Stand-up comedian, bilingual crowd work': 'Humoriste de stand-up, interaction bilingue avec le public',
    'True-crime-meets-folklore live podcast': 'Podcast en public entre true crime et folklore',
    'Analog-synth electronic duo': 'Duo électronique aux synthés analogiques',
    'Americana / alt-country five-piece': 'Quintette americana / alt-country',
    'Montreal dream-pop trio': 'Trio dream-pop de Montréal',
    'Stand-up comedian on a theater run': 'Humoriste de stand-up en tournée des théâtres',
    'Horror and true-crime podcast, live shows': 'Podcast horreur et true crime, en public',
    'Ambient electronic act': 'Projet électronique ambient',
    'Folk duo, small for the graph alone': 'Duo folk, trop petit pour le graphe seul',

    // ---- agent run ----
    'Planning {artist}.': 'Planification de {artist}.',
    'Connecting to the agent…': 'Connexion à l’agent…',
    'The live view is blocked on this network. The plan is still being built…': 'L’affichage en direct est bloqué sur ce réseau. Le plan continue de se construire…',
    'Attached to the run already in progress. No second plan was started.': 'Rattaché à l’exécution déjà en cours. Aucun second plan n’a été lancé.',
    '{name} is planned': '{name} est planifié',
    '{requests} in {s} s': `{requests} en {s}${NB}s`,
    'Daily limit reached': 'Limite quotidienne atteinte',
    'The agent stopped': 'L’agent s’est arrêté',
    'Unknown error.': 'Erreur inconnue.',
    'Daily demo limit reached for this address. Try a precomputed demo.': 'Limite quotidienne de démos atteinte pour cette adresse. Essayez une démo précalculée.',
    'The connection dropped': 'La connexion a été coupée',
    'The agent could not start': 'L’agent n’a pas pu démarrer',
    'The plan keeps running on the server. Try again to pick it up where it is.': 'Le plan continue sur le serveur. Réessayez pour le reprendre là où il en est.',
    'The server may be restarting. Try again in a moment.': 'Le serveur redémarre peut-être. Réessayez dans un instant.',
    'this act': 'cet artiste',
    'No plan for {artist} yet.': 'Pas encore de plan pour {artist}.',
    'Nothing was saved. The details are below.': 'Rien n’a été enregistré. Les détails sont ci-dessous.',
    // progress phrases (toolPhrase)
    'the room': 'la salle',
    'Finding “{name}” in Qloo’s taste graph.': `Recherche de «${NB}{name}${NB}» dans le graphe de goût de Qloo.`,
    'Ranking 34 metros by taste against population.': `Classement des 34 métropoles${NB}: goût contre population.`,
    'Profiling the audience (aggregate segments only).': 'Profil du public (segments agrégés uniquement).',
    'Checking six months of momentum.': 'Analyse de six mois de tendance.',
    '{city}: picking the room.': `{city}${NB}: choix de la salle.`,
    '{city}: picking an after-show spot.': `{city}${NB}: choix d’un lieu d’after.`,
    '{city}: picking the crowd brief.': `{city}${NB}: préparation du brief public.`,
    'Picking local spots.': 'Choix des lieux locaux.',
    '{city}: finding an opener with the same taste.': `{city}${NB}: recherche d’une première partie au goût proche.`,
    'Finding openers.': 'Recherche de premières parties.',
    '{city}: matching brands this crowd loves.': `{city}${NB}: sélection des marques que ce public aime.`,
    'Matching sponsors.': 'Sélection des sponsors.',
    'Asking the same model for a plan without Qloo, for the comparison.': 'Même modèle, plan sans Qloo, pour la comparaison.',
    'Running {name}.': 'Exécution de {name}.',
    // plan steps (server stage names)
    'Resolve': 'Identifier',
    'Markets': 'Marchés',
    'Audience': 'Public',
    'Timing': 'Tendance',
    'Dates': 'Dates',
    'Proof': 'Preuve',
    'Book': 'Synthèse',
    'Step {k} of {n}: {stage}': `Étape {k} sur {n}${NB}: {stage}`,

    // ---- agent view ----
    'The agent is planning {artist}.': 'L’agent planifie {artist}.',
    'Each tool call and each Qloo request appears below as it happens.': 'Chaque appel d’outil et chaque requête Qloo apparaissent ci-dessous en direct.',
    '{name} failed: {error}': `{name} a échoué${NB}: {error}`,
    'tool call': 'appel d’outil',
    'tool calls': 'appels d’outils',
    'Qloo request': 'requête Qloo',
    'Qloo requests': 'requêtes Qloo',
    'request': 'requête',
    'requests': 'requêtes',
    'endpoint': 'endpoint',
    'endpoints': 'endpoints',
    'distinct query shape': 'forme de requête distincte',
    'distinct query shapes': 'formes de requête distinctes',
    '{tools} and {requests} in {s} s.': `{tools} et {requests} en {s}${NB}s.`,
    '{n} rejected by the parameter validator.': `Requêtes refusées par le validateur de paramètres${NB}: {n}.`,
    'None was rejected by the parameter validator.': 'Aucune n’a été refusée par le validateur de paramètres.',
    'Every fact in the plan comes from one of these results.': 'Chaque fait du plan provient de l’un de ces résultats.',
    'Final answer': 'Réponse finale',
    'Tool calls': 'Appels d’outils',
    'typed, schema-checked': 'typés, vérifiés par schéma',
    'each one cited in the plan': 'chacune citée dans le plan',
    'Endpoints': 'Endpoints',
    'Filter types': 'Types de filtre',
    'heatmap, demographics, entities': 'heatmap, démographie, entités',
    'Endpoint': 'Endpoint',
    'Calls': 'Appels',
    'Heatmap scores come from one national call, so every city is on the same scale.': `Les scores de heatmap viennent d’un seul appel national${NB}: toutes les villes sont sur la même échelle.`,
    'Parameter validator': 'Validateur de paramètres',
    '{rejected} of {calls} requests rejected. Qloo ignores bad parameters silently, so we check each one first.': `{rejected} requête(s) refusée(s) sur {calls}. Qloo ignore les paramètres invalides sans le signaler${NB}: nous vérifions donc chacun d’abord.`,
    'Key stays on the server': 'La clé reste sur le serveur',
    'GET only. The browser never talks to Qloo or to the model.': 'GET uniquement. Le navigateur ne parle jamais à Qloo ni au modèle.',
    'One plan per click': 'Un plan par clic',
    'A double click or a reconnect joins the run in flight. A daily cap per address protects the quota.': 'Un double clic ou une reconnexion rejoint l’exécution en cours. Un plafond quotidien par adresse protège le quota.',
    'Data source': 'Source des données',
    'Live Qloo Insights API, aggregate affinities, never individuals.': 'API Qloo Insights en direct, affinités agrégées, jamais d’individus.',
    'Synthetic data in mock mode. Responses mirror Qloo’s shapes; names are invented.': `Données fictives en mode simulé. Les réponses reprennent les formats de Qloo${NB}; les noms sont inventés.`,
    'Planner': 'Planificateur',
    'Scripted planner running the real tool loop (no model key on this server).': 'Planificateur scripté qui exécute la vraie boucle d’outils (pas de clé de modèle sur ce serveur).',
    '{model} with tool calling.': '{model} avec appels d’outils.',

    // ---- results ----
    'No market ranking came back': 'Aucun classement de marchés n’est revenu',
    'The agent could not resolve this act. Add three sound-alike acts and try again.': 'L’agent n’a pas pu identifier cet artiste. Ajoutez trois artistes similaires et réessayez.',
    'No market stood out for this act.': 'Aucun marché ne se détache pour cet artiste.',
    ', and a plan without Qloo would miss {n} of these {top} stops': ', et un plan sans Qloo manquerait {n} de ces {top} étapes',
    'Lead market': 'Marché principal',
    'Hidden Market Score {hms}': 'Score de marché caché {hms}',
    'Hidden markets': 'Marchés cachés',
    'of {n}': 'sur {n}',
    'beat their population rank by 5+': 'dépassent leur rang de population de 5+',
    'Changed by Qloo': 'Changés par Qloo',
    'stops a population plan misses': 'étapes qu’un plan par population rate',
    '{n} rejected': '{n} refus',
    'Source: Qloo Insights API. Aggregate taste affinities, never individuals.': `Source${NB}: API Qloo Insights. Affinités de goût agrégées, jamais d’individus.`,
    'Synthetic data: acts, venues, brands and numbers are invented in mock mode, with Qloo’s real request and response shapes.': `Données fictives${NB}: artistes, salles, marques et chiffres sont inventés en mode simulé, avec les vrais formats de requête et de réponse de Qloo.`,
    'Agent: {agent}. Planned {date}.': `Agent${NB}: {agent}. Planifié le {date}.`,
    'scripted planner': 'planificateur scripté',
    'Date {n}, {name}. Open the dossier': 'Date {n}, {name}. Ouvrir le dossier',
    'Taste #{taste}, population #{pop}': 'Goût #{taste}, population #{pop}',
    'Hidden market': 'Marché caché',
    'Room': 'Salle',
    'Opener': 'Première partie',
    'Sponsor': 'Sponsor',
    'After-show': 'After',
    '{n} % taste fit': `{n}${NB}% d’accord de goût`,
    'No dates could be prepped for this act.': 'Aucune date n’a pu être préparée pour cet artiste.',
    'Route: {route}. Nearest-neighbour order, so the van doesn’t zigzag.': `Itinéraire${NB}: {route}. Ordre du plus proche voisin, pour que le van ne zigzague pas.`,
    'The no-Qloo baseline did not come back for this run.': 'Le plan de référence sans Qloo n’est pas revenu pour cette exécution.',
    ' and {shared} stays': ' et {shared} reste',
    ' and {shared} stay': ' et {shared} restent',
    'Strategy: {s}, per city, approximate.': `Stratégie${NB}: {s}, par ville, approximative.`,
    'Scored from one national heatmap call, so cities compare fairly.': `Notés à partir d’un seul appel heatmap national${NB}: les villes se comparent équitablement.`,
    'City': 'Ville',
    'Hidden Market Score': 'Score de marché caché',
    'Taste rank': 'Rang de goût',
    'Population rank': 'Rang de population',
    'Gap': 'Écart',
    'Verdict': 'Verdict',
    '{name}, Hidden Market Score {hms}. Open the dossier': '{name}, Score de marché caché {hms}. Ouvrir le dossier',
    'taste · #{pop} population': 'goût · #{pop} population',
    'Qloo returned no demographic signal for this act. The rest of the plan does not depend on it.': 'Qloo n’a renvoyé aucun signal démographique pour cet artiste. Le reste du plan n’en dépend pas.',
    '24 and under': '24 ans et moins',
    '25–29': '25–29 ans',
    '30–34': '30–34 ans',
    '35–44': '35–44 ans',
    '45–54': '45–54 ans',
    '55+': '55 ans et plus',
    'Men': 'Hommes',
    'Women': 'Femmes',
    'Over-indexes most with <strong>{seg}</strong>. ': `Surreprésentation la plus forte${NB}: <strong>{seg}</strong>. `,
    'Positive means over-represented. Not a headcount, never about individuals.': 'Positif = surreprésenté. Pas un décompte, jamais des individus.',
    'No trend data for this window. Room sizes fall back to the taste score alone.': 'Pas de données de tendance sur cette période. La taille des salles repose sur le seul score de goût.',
    '{from} to {to}, weekly percentile from <code>/v2/trending</code>': 'Du {from} au {to}, percentile hebdomadaire d’après <code>/v2/trending</code>',
    'Rising': 'En hausse',
    'Cooling': 'En baisse',
    'Steady': 'Stable',
    'Unknown': 'Inconnue',
    'rising': 'en hausse',
    'cooling': 'en baisse',
    'steady': 'stable',
    'unknown': 'inconnue',
    '{delta} percentile points over the window': '{delta} points de percentile sur la période',
    'Weekly popularity percentile, {verdict}, from {from} to {to}': 'Percentile de popularité hebdomadaire, {verdict}, de {from} à {to}',
    'Momentum is up: consider booking one size up for later dates.': `La tendance est à la hausse${NB}: envisagez une salle plus grande pour les dates suivantes.`,
    'Momentum is down: keep rooms tight, sell out small.': `La tendance est à la baisse${NB}: gardez des salles compactes et affichez complet.`,
    'Hold venue sizes.': 'Gardez la taille des salles.',

    // ---- map ----
    'The map could not load (offline?). The plan below still works.': `La carte n’a pas pu se charger (hors ligne${NB}?). Le plan ci-dessous fonctionne quand même.`,
    'The map could not load ({error}). The plan below still works.': 'La carte n’a pas pu se charger ({error}). Le plan ci-dessous fonctionne quand même.',
    ', Hidden Market Score {hms}': ', Score de marché caché {hms}',
    '. Open the dossier': '. Ouvrir le dossier',
    'taste #{taste} vs population #{pop}': 'goût #{taste} contre population #{pop}',
    'Metro population {pop}. Run a plan to score it by taste.': 'Population de la métropole {pop}. Lancez un plan pour la noter selon le goût.',
    '34 US metros': '34 métropoles américaines',
    'Sized by population, the way tours are usually routed.': 'Taille selon la population, comme on trace d’habitude les tournées.',
    'Scoring them by taste…': 'Notation selon le goût…',
    'Scored by taste': 'Notées selon le goût',
    'The top markets light up as the agent ranks them. Preparing the dates…': 'Les meilleurs marchés s’allument à mesure que l’agent les classe. Préparation des dates…',
    'higher': 'plus élevé',
    'Size is taste affinity. A ring marks a hidden market.': 'La taille indique l’affinité de goût. Un anneau signale un marché caché.',
    'Fan heat: {n} areas from one Qloo heatmap call': 'Chaleur des fans : {n} zones, issues d’un seul appel heatmap de Qloo',
    'Population': 'Population',
    'bigger': 'plus grande',
    'What a model without taste data proposes.': 'Ce que propose un modèle sans données de goût.',
    'Show without Qloo': 'Voir sans Qloo',
    'Show with Qloo': 'Voir avec Qloo',

    // ---- dossier ----
    'Asking Qloo for the room, opener, sponsor and crowd in {city}…': 'Qloo cherche la salle, la première partie, le sponsor et le public à {city}…',
    'This dossier did not load': 'Ce dossier ne s’est pas chargé',
    '{error}. The plan itself is unchanged.': '{error}. Le plan lui-même est inchangé.',
    'Next market: {name}': `Marché suivant${NB}: {name}`,
    'Date {n} of the tour.': 'Date {n} de la tournée.',
    'In the top markets, not yet a prepped date.': 'Parmi les meilleurs marchés, pas encore une date préparée.',
    'Outside the top markets.': 'Hors des meilleurs marchés.',
    'Taste does not beat population here ({gap}).': 'Ici, le goût ne dépasse pas la population ({gap}).',
    'Taste affinity {aff} of 100, metro population {pop}.': 'Affinité de goût {aff} sur 100, population de la métropole {pop}.',
    'Qloo request behind this pick': 'Requête Qloo derrière ce choix',
    'Qloo requests ({n}) behind this pick': 'Requêtes Qloo ({n}) derrière ce choix',
    'Which inputs drove this pick': 'Quelles entrées ont guidé ce choix',
    'Signal': 'Signal',
    'Qloo returned nothing for this slot. The agent leaves it open rather than guess.': 'Qloo n’a rien renvoyé pour ce créneau. L’agent le laisse libre plutôt que de deviner.',
    'affinity': 'affinité',
    'Also strong: {names}': `Aussi en bonne place${NB}: {names}`,
    '{n} % taste fit with the headliner': `{n}${NB}% d’accord de goût avec la tête d’affiche`,
    ', shared: {list}': `, en commun${NB}: {list}`,
    '; adds {list}': `${NB}; apporte {list}`,
    'Shows they watch:': `Séries qu’ils regardent${NB}:`,
    'Podcasts:': `Podcasts${NB}:`,
    'Local themes for the set and the crowd work:': `Thèmes locaux pour le set et l’interaction avec le public${NB}:`,
    'Sponsor fit': 'Sponsors adaptés',
    'After-show spot': 'Lieu d’after',
    'Crowd brief': 'Brief public',
    'No crowd signal for this city.': 'Aucun signal sur le public pour cette ville.',
    'Qloo affinities describe aggregate audiences, never individuals.': 'Les affinités Qloo décrivent des publics agrégés, jamais des individus.',
    'Synthetic data in mock mode. Affinities describe aggregate audiences, never individuals.': 'Données fictives en mode simulé. Les affinités décrivent des publics agrégés, jamais des individus.',
    '{name}: tour plan': `{name}${NB}: plan de tournée`,
    'Date dossiers': 'Dossiers des dates',
    'Markets ranked by Hidden Market Score': 'Marchés classés par score de marché caché',
    'The PDF could not be created': 'Le PDF n’a pas pu être créé',
    'Check the connection, then try again.': 'Vérifiez la connexion, puis réessayez.',
    'Each pick cites a Qloo request; the full request log is in Tourbook’s Agent view.': `Chaque choix cite une requête Qloo${NB}; le journal complet des requêtes est dans la vue Agent de Tourbook.`,
    'Date {n}: {name}': `Date {n}${NB}: {name}`,
    // synthetic entity descriptions (mock mode only; live descriptions are Qloo data and stay as sent)
    'Bar / late-night spot (synthetic)': 'Bar / lieu de fin de soirée (fictif)',
    'Lifestyle brand (synthetic)': 'Marque lifestyle (fictive)',
    'Artist (synthetic)': 'Artiste (fictif)',
    'TV series (synthetic)': 'Série TV (fictive)',
    'Podcast (synthetic)': 'Podcast (fictif)',
    'Synthetic entity generated for mock mode': 'Entité fictive générée pour le mode simulé',

    // ---- voice briefing ----
    'Here\'s your tour, boss. {name}.': 'Voici votre tournée, patron. {name}.',
    'Lead with {city}. Hidden Market Score {hms}: taste rank {taste}, population rank only {pop}.': `Commencez par {city}. Score de marché caché {hms}${NB}: rang de goût {taste}, rang de population seulement {pop}.`,
    'Then {a} and {b}.': 'Puis {a} et {b}.',
    'In {city}, play {venue}': 'À {city}, jouez à {venue}',
    ', open with {name}': ', avec {name} en première partie',
    ', and pitch {name} as sponsor': ', et proposez {name} comme sponsor',
    'After the {city} show, the crowd goes to {place}.': 'Après le concert de {city}, le public se retrouve à {place}.',
    '{city} closes the first run.': '{city} clôt la première série de dates.',
    'A model without taste data would have missed {n} of these stops.': 'Un modèle sans données de goût aurait manqué {n} de ces étapes.',
    'Note: this is synthetic demo data.': `Remarque${NB}: ce sont des données de démonstration fictives.`,
    'Preparing the briefing…': 'Préparation du briefing…',

    // ---- share ----
    'Link copied': 'Lien copié',
    'Opening it replays this plan.': 'Ouvrir ce lien rejoue ce plan.',
    'Copy this link': 'Copiez ce lien',
    'Open': 'Ouvrir',

    // ---- room mode ----
    'Loading acts': 'Chargement des artistes',
    'Popularity under {cap}': 'Popularité sous {cap}',
    'Act': 'Artiste',
    'Local fit': 'Accord local',
    'Popularity': 'Popularité',
    'fit': 'accord',
    'Local fit is Qloo affinity for the people around {hood}': 'L’accord local est l’affinité Qloo des gens autour de {hood}',
    'No acts under {cap} popularity here': 'Aucun artiste sous {cap} de popularité ici',
    'Raise the popularity cap, or try a wider area such as the city name.': 'Relevez le plafond de popularité ou essayez une zone plus large, comme le nom de la ville.',
    'Qloo could not place “{hood}”': `Qloo n’a pas pu situer «${NB}{hood}${NB}»`,
    'Room mode is unavailable right now': 'Le mode salle est indisponible pour le moment',
    'Add the city, for example “Wicker Park, Chicago”.': `Ajoutez la ville, par exemple «${NB}Wicker Park, Chicago${NB}».`,
    '{error}. Try again in a moment.': '{error}. Réessayez dans un instant.',
  };
  // Plural- or count-sensitive French templates.
  Object.assign(FR, {
    '<strong>{name} leads the tour.</strong> Fans rank it <span class="taste">#{taste} for taste</span> but it is only #{pop} for population. {hidden} of the top {top} markets are hidden markets{miss}.': (v) =>
      `<strong>{name} mène la tournée.</strong> Les fans la placent <span class="taste">n°${NB}{taste} pour le goût</span>, mais elle n’est que n°${NB}{pop} en population. ${Number(v.hidden) === 0 ? 'Aucun des {top} premiers marchés n’est un marché caché' : Number(v.hidden) === 1 ? 'Un des {top} premiers marchés est un marché caché' : '{hidden} des {top} premiers marchés sont des marchés cachés'}{miss}.`,
    '{n} hidden markets out of {total}.': (v) => (Number(v.n) <= 1 ? '{n} marché caché sur {total}.' : '{n} marchés cachés sur {total}.'),
    'Same act, same question. Without taste data the plan follows population. With Qloo, {n} of {total} stops change{stay}. Stops in bold are the ones only Qloo found.': (v) =>
      `Même artiste, même question. Sans données de goût, le plan suit la population. Avec Qloo, {n} étape${Number(v.n) > 1 ? 's' : ''} sur {total} change${Number(v.n) > 1 ? 'nt' : ''}{stay}. Les étapes en gras sont celles que seul Qloo a trouvées.`,
    'Beats its population rank by {n} places.': (v) => (Number(v.n) === 1 ? 'Dépasse son rang de population d’une place.' : 'Dépasse son rang de population de {n} places.'),
    '{n} acts for {hood}': (v) => (Number(v.n) <= 1 ? '{n} artiste pour {hood}' : '{n} artistes pour {hood}'),
  });

  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s);
  /** t('English {x}', { x }) -> the French template when French is on and known, else the English one; placeholders filled. */
  function t(en, vars) {
    if (LANG !== 'fr' || FR[en] == null) return fill(en, vars);
    const v = FR[en];
    return fill(typeof v === 'function' ? v(vars || {}) : v, vars);
  }
  /** Server data written in English (mock descriptions): exact match, then the few templated shapes. */
  function tData(s) {
    if (LANG !== 'fr' || !s) return s;
    if (FR[s] != null) return t(s);
    const venue = /^Live music venue, ~(\d+) cap \(synthetic\)$/.exec(s);
    if (venue) return `Salle de concert, ~${venue[1]}${NB}places (fictif)`;
    const sim = /^Similar-sounding act #(\d+) \(synthetic\)$/.exec(s);
    if (sim) return `Artiste similaire n°${NB}${sim[1]} (fictif)`;
    const base = /^(.*) \(synthetic\)$/.exec(s);
    if (base && FR[base[1]] != null) return `${t(base[1])} (fictif)`;
    return s;
  }
  /** Decimal comma in French ("3.2" -> "3,2"); English untouched. */
  const dec = (s) => (LANG === 'fr' ? String(s).replace('.', ',') : String(s));

  // Static markup: translate text nodes and the aria-label / placeholder / title attributes in place.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'svg', 'TEXTAREA']);
  function translatePage(root = document.body) {
    if (LANG === 'en' || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        for (let p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) if (SKIP.has(p.nodeName) || p.hasAttribute?.('data-no-i18n')) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const raw = n.nodeValue; const key = raw.trim().replace(/\s+/g, ' ');
      if (FR[key] == null || typeof FR[key] !== 'string') continue;
      const lead = raw.match(/^\s*/)[0] ? ' ' : ''; const tail = raw.match(/\s*$/)[0] ? ' ' : '';
      n.nodeValue = lead + FR[key] + tail;
    }
    for (const a of ['aria-label', 'placeholder', 'title']) {
      for (const el of root.querySelectorAll(`[${a}]`)) {
        if (el.closest('[data-no-i18n]')) continue;
        const v = el.getAttribute(a);
        if (typeof FR[v] === 'string') el.setAttribute(a, FR[v]);
      }
    }
  }

  // Language switch (EN / FR): saves the choice, then reloads the same view in the other language (no auto-run).
  function bindSwitch() {
    for (const b of document.querySelectorAll('[data-lang]')) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === LANG));
      b.addEventListener('click', () => {
        const next = b.dataset.lang;
        if (!SUPPORTED.includes(next) || next === LANG) return;
        try { localStorage.setItem('lang', next); } catch { /* the URL param below still carries it */ }
        const url = new URL(location.href);
        url.searchParams.set('lang', next);
        // Changing language must never start a plan: drop the params that auto-run one on load.
        for (const k of ['demo', 'artist', 'proxies', 'type', 'rid']) url.searchParams.delete(k);
        location.replace(url.toString());
      });
    }
  }

  window.LANG = LANG;
  window.LOCALE = LANG === 'fr' ? 'fr-FR' : 'en-US';
  window.t = t;
  window.tData = tData;
  window.dec = dec;
  window.translatePage = translatePage;
  translatePage();
  bindSwitch();
})();
