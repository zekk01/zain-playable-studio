// Single source of truth for all portfolio content.
// Edit this file to add images, projects, or links — the page renders from it.
// Image entries: { src, alt, fit?: 'contain' }. Video entries: { src, poster, alt, href?, source?, portrait? }.

const G = (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;

export const site = {
  name: 'Zain Kassem',
  title: 'Game Designer & Developer',
  location: 'Dubai, UAE',
  email: 'zainkassem7@gmail.com',
  phone: '+971 56 453 8560',
  linkedin: 'https://www.linkedin.com/in/zain-kassem-a60176183/',
  instagram: 'https://www.instagram.com/zainkassem000/',
  instagramHandle: '@zainkassem000',
  instagramFollowers: '34.6K',
  cvDesign: 'assets/cv/Zain_Kassem_GameDesigner.pdf',
  cvTech: 'assets/cv/Zain_Kassem.pdf',
  toolkit: ['Unreal Engine', 'Unity', 'C++ / C#', 'Systems design', 'Creative direction', 'Blueprint · Behavior Trees · EQS', 'React Native', 'Python', 'VR · WebGL · Mobile', 'Economy & progression', 'Narrative', 'Live-ops & F2P'],
};

export const hero = {
  eyebrow: 'PLAYER ONE · DUBAI, UAE',
  lines: ['I build worlds.', 'And the rules', 'that make them work.'],
  sub: 'Game designer. Developer. Curious by default.\nWelcome to the place where it all connects.',
  cta: 'Explore my work',
  tagline: ['DESIGNING THE EXPERIENCE.', 'BUILDING WHAT’S UNDERNEATH.'],
  hotspots: [
    { id: 'work', number: '01', label: 'The workbench', target: '#work' },
    { id: 'book', number: '02', label: 'The field manual', target: '#book' },
    { id: 'ideas', number: '03', label: 'Behind the ideas', target: '#ideas' },
    { id: 'lalapoker', number: '04', label: 'The card table', target: '#lalapoker' },
    { id: 'citycrafters', number: '05', label: 'The studio floor', target: '#citycrafters' },
  ],
};

const PLAY = (id) => `https://play.google.com/store/apps/details?id=${id}`;

export const companies = [
  {
    id: 'city-crafters', name: 'City Crafters', period: '2024–2026',
    role: 'Game design · Product leadership · Real-time 3D',
    description: 'From a multiplayer pit lane to worlds you can explore. Leading game and product design across VR, mobile, and branded interactive experiences.',
    foot: 'Built a cross-functional team from 0 to 12 across design, engineering, art/UI, and QA. Sprint workflows cut feature-delivery time by 35%.',
    cover: 'assets/img/citycrafters/neon-city.jpg',
    site: 'https://citycrafters.ae/',
    projects: [
      {
        id: 'pit-protocol', title: 'Pit Protocol', tag: 'VR / LIVE EXPERIENCE', hook: 'A pit stop becomes a team sport.',
        contribution: 'Led the design and delivery of a distributed VR pit-stop simulator for Yas Marina / Abu Dhabi GP activations with Emaar and Address Hospitality, run live at Address Beach Resort in December 2025.',
        challenge: 'Turn a precise, coordinated task into an accessible shared challenge. Players have to understand their role, react to clear feedback, and work together under time pressure, and a leaderboard keeps the crowd coming back.',
        outcome: 'Delivered a demo-ready prototype in five months: six synchronized stations, sub-20 ms state sync, and 98% uptime across live event days.',
        images: [
          { src: 'assets/img/citycrafters/pit-protocol-recap.jpg', alt: 'Pit Protocol activation at Address Beach Resort' },
          { src: 'assets/img/citycrafters/pit-protocol-day3.jpg', alt: 'Day 3 of the Pit Protocol activation' },
          { src: 'assets/img/citycrafters/pit-protocol-recap-2.jpg', alt: 'Players in the VR pit lane' },
          { src: 'assets/img/citycrafters/pit-protocol-recap-3.jpg', alt: 'The Pit Protocol stations at the event' },
          { src: 'assets/img/citycrafters/pit-protocol.png', alt: 'Pit Protocol title card', fit: 'contain' },
        ],
        videos: [
          { src: 'assets/video/pit-protocol-recap.mp4', poster: 'assets/img/citycrafters/pit-protocol-recap.jpg', alt: 'Activation recap at Address Beach Resort (Dec 9, 2025)', href: 'https://www.instagram.com/p/DSDEYnNgSn7/', source: 'Instagram', portrait: true },
          { src: 'assets/video/pit-protocol-day3.mp4', poster: 'assets/img/citycrafters/pit-protocol-day3.jpg', alt: 'Day 3: challenging the leaderboard (Dec 7, 2025)', href: 'https://www.instagram.com/p/DR9Q4bbgTbu/', source: 'Instagram', portrait: true },
        ],
        google: G('Pit Protocol VR City Crafters Address Beach Resort'),
        links: [{ label: 'City Crafters', href: 'https://citycrafters.ae/' }, { label: 'City Crafters on Instagram', href: 'https://www.instagram.com/citycrafters.ae/' }],
      },
      {
        id: 'hologram-cloud', title: 'Hologram Cloud', tag: 'INTERACTIVE VISUALIZATION', hook: 'Property, explored in real time.',
        contribution: 'Architected an interactive real-estate visualization platform spanning eight property models, from model-to-runtime workflows to asset streaming.',
        challenge: 'Make complex spaces easy to explore while keeping large environments responsive. Asset streaming and level-of-detail work supported the experience.',
        outcome: 'Reduced asset load times by 45%, with +60 NPS reported in field tests.',
        images: [
          { src: 'assets/img/hxr/holo-wireframe.jpg', alt: 'Holographic wireframe of a building' },
          { src: 'assets/img/hxr/realestate-tower.jpg', alt: 'Real-estate tower visualization' },
          { src: 'assets/img/hxr/dubai-balcony.jpg', alt: 'Dubai skyline from a property balcony' },
          { src: 'assets/img/hxr/lightframe-27.jpg', alt: 'LightFrame 27-inch holographic display' },
          { src: 'assets/img/hxr/vista-table.png', alt: 'Vista Table holographic display' },
        ],
        google: G('City Crafters HXR hologram real estate visualization Dubai'),
        links: [{ label: 'City Crafters HXR', href: 'https://www.citycrafters.ae/hxr' }],
      },
      {
        id: 'unseen-blade', title: 'Unseen Blade', tag: 'MOBILE / STEALTH ACTION · GOOGLE PLAY', hook: 'See the world through sound.',
        contribution: 'Directed the core loop, combat rules, feedback, difficulty progression, and player-facing UX, from concept to the first playable release on Google Play.',
        challenge: 'You play a fallen warrior left blind after a betrayal. Echo-location turns sound into spatial information: enemy movement, incoming danger and hidden paths all emerge through your senses, so stealth, movement and the rhythm of encounters have to stay readable without sight.',
        outcome: 'First playable version live on Google Play (April 2026), set in a stylized feudal Japan with a dark, futuristic edge. Three campaign chapters, story mode, shadow trials and training grounds.',
        images: [
          { src: 'assets/img/unseenblade/02.jpg', alt: 'Unseen Blade: the swordsman on the main menu (story mode, shadow trials, training grounds)', pos: '50% 28%' },
          { src: 'assets/img/unseenblade/03.jpg', alt: 'Unseen Blade: sensing an enemy through echo-location' },
          { src: 'assets/img/unseenblade/05.jpg', alt: 'Unseen Blade: a strike lands' },
          { src: 'assets/img/unseenblade/04.jpg', alt: 'Unseen Blade: moving through the dark' },
          { src: 'assets/img/unseenblade/01.jpg', alt: 'Campaign chapters: Silent Corridor, Crimson Dawn, Veil of Shadows' },
          { src: 'assets/img/unseenblade/icon.png', alt: 'Unseen Blade icon', fit: 'contain' },
        ],
        google: G('Unseen Blade CityCrafters stealth game'),
        links: [{ label: 'Google Play', href: PLAY('com.citycrafters.unseenblade') }],
      },
      {
        id: 'target-destroyed', title: 'Target Destroyed', tag: 'ARCADE / MOBILE · GOOGLE PLAY', hook: 'Thirty seconds. Make every shot count.',
        contribution: 'Directed combat rules, enemy structure, session pacing, difficulty, and HUD feedback, then shipped it on Google Play.',
        challenge: 'You command an F-16 patrolling the Gulf while hostile drones swarm the sector. Every sortie is 30 seconds of arcade combat extended by every kill: smart lock-on, gold high-value targets worth 3x, a combo multiplier that resets when you lose your rhythm. Each resource changes the next decision.',
        outcome: 'Live on Google Play with hangar upgrades, cosmetic loadouts, three global leaderboards, daily challenges, pilot ranks from Cadet to Ace Commander, and a FLIR-style military HUD. Plays in portrait or landscape at 60 fps.',
        images: [
          { src: 'assets/img/targetdestroyed/02.jpg', alt: 'Target Destroyed: missile lock on a drone' },
          { src: 'assets/img/targetdestroyed/01.jpg', alt: 'Target Destroyed: gun-cam view over the Gulf' },
          { src: 'assets/img/targetdestroyed/03.jpg', alt: 'Target Destroyed: targeting system briefing' },
          { src: 'assets/img/targetdestroyed/icon.png', alt: 'Target Destroyed crosshair icon', fit: 'contain' },
        ],
        google: G('Target Destroyed CityCrafters F-16 drone arcade game'),
        links: [{ label: 'Google Play', href: PLAY('ae.citycrafters.dronehunter') }],
      },
    ],
  },
  {
    id: 'lala-gaming', name: 'Lala Gaming', period: '2023–2025',
    role: 'Game design · Unity · Live-ops',
    description: 'A live multiplayer card room on iOS, Android, and the browser: Texas Hold’em at the core, with Omaha, tournaments, Blackjack, Roulette, and a lottery layered on top.',
    foot: 'Shipped on the App Store and Google Play (LALAGAMING LLC). Rated 4.6 on the App Store.',
    cover: 'assets/img/lalapoker/og.jpg',
    site: 'https://lalapoker.com/',
    projects: [
      {
        id: 'lalapoker', title: 'Lala Poker', tag: 'MOBILE / WEBGL · LIVE GAME', hook: 'Real players. Real pressure. Every hand counts.',
        contribution: 'Designed and built the multiplayer poker experience: table flow, betting UX, tournament structure, progression, quests, and the economy around chips, jackpots, and VIP tiers.',
        challenge: 'Poker has to feel fair, fast, and readable at a glance. Every decision (check, call, raise, fold) needs clear feedback under a timer, while the meta-game gives players reasons to come back every day.',
        outcome: 'Live on the App Store, Google Play, and lalapoker.com (Unity WebGL). Modes: Hold’em, Omaha, Sit & Go, multi-table tournaments, Blackjack, Roulette, Lottery, daily quests, and an avatar marketplace.',
        images: [
          { src: 'assets/img/lalapoker/shot-01.jpg', alt: 'Lala Poker Texas Hold’em table with a Two Pair hand' },
          { src: 'assets/img/lalapoker/shot-14.jpg', alt: 'Omaha table in the casino lobby' },
          { src: 'assets/img/lalapoker/shot-10.jpg', alt: 'Multi-table tournament lobby' },
          { src: 'assets/img/lalapoker/shot-15.jpg', alt: 'Lottery, jackpots, and game selection lobby' },
          { src: 'assets/img/lalapoker/shot-11.jpg', alt: 'Blackjack win screen' },
          { src: 'assets/img/lalapoker/shot-05.jpg', alt: 'Roulette table' },
          { src: 'assets/img/lalapoker/shot-09.jpg', alt: 'Active quest: word puzzle for chips' },
          { src: 'assets/img/lalapoker/shot-12.jpg', alt: 'Avatar inventory and special items' },
          { src: 'assets/img/lalapoker/play-poker-hub.jpg', alt: 'Lala: the ultimate poker hub' },
        ],
        google: G('Lala Poker app LALAGAMING Texas Holdem'),
        links: [
          { label: 'App Store', href: 'https://apps.apple.com/us/app/lala-poker/id6461824824' },
          { label: 'Google Play', href: PLAY('com.lalagaming.lalapoker') },
          { label: 'Play in browser', href: 'https://lalapoker.com/' },
        ],
      },
    ],
  },
  {
    id: 'mastermind', name: 'MasterMind', period: 'FEB–JUL 2024',
    role: 'Game design · Narrative · Alpha production',
    description: 'Chronicles of Scimitars: Rise of Baybars, a single-player, story-driven RPG set in the 13th-century Middle East. You play Baybars I, a young enslaved Kipchak Turk who rises through the Mamluk military to become a revered sultan of Egypt.',
    foot: 'Led two developers and three artists through alpha development. The supporting campaign reached 1M+ views and grew the community to 40K+ followers. Listed on Steam; release date to be announced.',
    cover: 'assets/img/chronicles/hero.jpg',
    site: 'https://store.steampowered.com/app/3010500/Chronicles_of_Scimitars__Rise_of_Baybars/',
    projects: [
      {
        id: 'chronicles-of-scimitars', title: 'Chronicles of Scimitars: Rise of Baybars', tag: 'PC / STEAM · STORY-DRIVEN RPG', hook: 'From slave to sultan. A setting with a story to tell.',
        contribution: 'Directed design and alpha development across systems, narrative, content, and player experience: strategic combat and leadership decisions, a living world that reacts to your choices, and a storyteller NPC who narrates tales of poets and warriors.',
        challenge: 'Connect the historical setting to what players actually do: their goals, encounters, progression, and relationships, from the streets of Cairo to the landscapes of the Levant, with meticulously researched architecture and events.',
        outcome: 'Alpha development with a content strategy spanning DLC, content packs, and collectibles. Wishlist open on Steam with full controller support and 18 supported languages.',
        images: [
          { src: 'assets/img/chronicles/hero.jpg', alt: 'Chronicles of Scimitars key art: Baybars overlooking the desert' },
          { src: 'assets/img/chronicles/03.jpg', alt: 'A Mamluk-era courtyard with a domed pavilion' },
          { src: 'assets/img/chronicles/04.jpg', alt: 'Baybars in a carpeted interior' },
          { src: 'assets/img/chronicles/01.jpg', alt: 'A spice market in Cairo' },
          { src: 'assets/img/chronicles/02.jpg', alt: 'A Cairo street with hanging lanterns' },
          { src: 'assets/img/chronicles/05.jpg', alt: 'A striped-stone gateway' },
          { src: 'assets/img/chronicles/06.jpg', alt: 'A training yard outside the walls' },
          { src: 'assets/img/chronicles/logo.png', alt: 'Chronicles of Scimitars logo', fit: 'contain' },
        ],
        google: G('Chronicles of Scimitars Rise of Baybars game'),
        links: [{ label: 'Steam', href: 'https://store.steampowered.com/app/3010500/Chronicles_of_Scimitars__Rise_of_Baybars/' }],
      },
    ],
  },
  {
    id: 'feral-flame', name: 'Feral Flame Studios', period: 'AUG 2021–AUG 2023',
    role: 'Gameplay programming · Systems design · Team leadership',
    description: 'An indie studio from Skellefteå, Sweden, that values gameplay above all else. Its first game, Primal Echo, is a retro-inspired Metroidvania that fuses survival with 3D action-platforming: climb, fight and bite your way out of an alien megastructure that harbors an ancient ecosystem.',
    foot: 'Formerly Nirah Studios. Prototyping and iteration helped support $600K+ in investment; managed internal and external contributors on an average $250K quarterly budget.',
    cover: 'assets/img/feral/swim.jpg',
    site: 'https://www.feralflamestudios.com/',
    projects: [
      {
        id: 'creature-ai', title: 'Creature AI', tag: 'PRIMAL ECHO · UNREAL / C++', hook: 'Behaviour with a reason behind it.',
        contribution: 'Designed and implemented AI with Behavior Trees and the Environment Query System, plus physics-based hunting loops for a brutal action-survival game set 80,000 years ago inside a colossal alien machine.',
        challenge: 'Pack behaviour, needs, aggression, and terrain navigation work together. The player needs readable behaviour even when the simulation is complex.',
        outcome: 'Implemented gameplay systems and contributed to technical prototyping.',
        images: [
          { src: 'assets/img/feral/throw.jpg', alt: 'Primal Echo: a hunt in the dark' },
          { src: 'assets/img/feral/swim.jpg', alt: 'Primal Echo: swimming below a waterfall' },
          { src: 'assets/img/nirah/concept.jpg', alt: 'Early concept art: a masked hunter in tall grass' },
          { src: 'assets/img/feral/logo.png', alt: 'Feral Flame Studios logo', fit: 'contain' },
        ],
        google: G('Feral Flame Studios Primal Echo game'),
        links: [{ label: 'Feral Flame Studios', href: 'https://www.feralflamestudios.com/' }],
      },
      {
        id: 'traversal', title: 'Traversal & inventory', tag: 'PRIMAL ECHO · GAMEPLAY SYSTEMS', hook: 'Give the player more ways forward.',
        contribution: 'Built climbing, wall-jumping, inventory, and interaction systems using C++ and Blueprint, and tuned parkour-style traversal through the megastructure.',
        challenge: 'Movement and interaction systems need consistent rules, readable feedback, and dependable behaviour across different environments.',
        outcome: 'Implemented reusable gameplay systems and coordinated internal and external contributors.',
        images: [
          { src: 'assets/img/feral/jump.jpg', alt: 'Primal Echo: a leap across a shaft of the megastructure' },
          { src: 'assets/img/feral/swim.jpg', alt: 'Primal Echo: swimming through a flooded chamber' },
          { src: 'assets/img/feral/throw.jpg', alt: 'Primal Echo: combat in the dark' },
        ],
        google: G('Unreal Engine climbing wall jump traversal system'),
        links: [{ label: 'Feral Flame Studios', href: 'https://www.feralflamestudios.com/' }],
      },
    ],
  },
  {
    id: 'swave', name: 'Swave Photonics', period: 'SEP–DEC 2023',
    role: 'C++ engineering · Unity integration · Holographic displays',
    description: 'Taking interactive 3D beyond the screen: Swave’s HXR chip is a spatial light modulator with sub-300 nm pixels that brings true holographic display to AR glasses, heads-up displays, and glasses-free holo walls.',
    foot: 'Worked with the algorithms team on formats, throughput, and rendering integration.',
    cover: 'assets/img/swave/holo-wall.jpg',
    site: 'https://swave.io/',
    projects: [
      {
        id: 'holo-pipeline', title: 'Holographic pipeline', tag: 'C++ / SPATIAL DISPLAY', hook: 'Real-time worlds. A different display.',
        contribution: 'Built a C++ pipeline bridging Unity render output and Swave’s proprietary HXR holographic display hardware, optimising meshes and shaders for true-colour, glasses-free holograms.',
        challenge: 'Rendering, data formats, and throughput have to work as one system to make an interactive demonstration possible.',
        outcome: 'A working holographic demonstration presented at CES.',
        images: [
          { src: 'assets/img/swave/holo-wall.jpg', alt: 'Holo Wall: glasses-free real 3D on a video wall' },
          { src: 'assets/img/swave/holo-hud.jpg', alt: 'Holo HUD: navigation at natural depth in a windshield' },
          { src: 'assets/img/swave/holo-ar.jpg', alt: 'Holo AR: holographic content in everyday glasses' },
          { src: 'assets/img/swave/hxr-chip.jpg', alt: 'The Swave HXR chip' },
          { src: 'assets/img/hxr/lightframe-butterfly.jpg', alt: 'Glasses-free holographic display showing a butterfly' },
          { src: 'assets/img/hxr/zenith-sphere.png', alt: 'Full-scale volumetric projection display' },
        ],
        videos: [
          { src: 'assets/video/swave-hxr-demo.mp4', poster: 'assets/img/swave/demo-poster.jpg', alt: 'Swave: life with HXR holographic AR (excerpt)', href: 'https://swave.io/', source: 'swave.io' },
        ],
        google: G('Swave Photonics HXR holographic display'),
        links: [{ label: 'Swave Photonics', href: 'https://swave.io/' }],
      },
    ],
  },
  {
    id: 'hyphonics', name: 'Hyphonics / X on Board', period: '2018–2021',
    role: 'Unity development · Mobile · Educational games',
    description: 'The early chapters: building complete Unity experiences, from gameplay and resource systems to UI, audio, and content spawning. The headline: AbjadPolis, an Arabic-learning game that turns your phone into a city you build word by word.',
    foot: 'Toronto & Beirut. Demos supported national TV coverage and $31K+ in grants and investment.',
    cover: 'assets/img/abjadpolis/city.jpg',
    site: PLAY('com.hyphonics.abjadpolis'),
    projects: [
      {
        id: 'abjadpolis', title: 'AbjadPolis', tag: 'MOBILE / EDUCATIONAL RPG · GOOGLE PLAY', hook: 'Learn Arabic by building a city.',
        contribution: 'Solo-built the Unity/C# game end-to-end: gameplay loops, UI, audio, level and content spawning, resource systems, and engagement mechanics. Gamified language drills into bite-sized quests with a level-gated loop.',
        challenge: 'Turn reading, writing, listening, and speaking exercises into play that a complete beginner enjoys and a fluent speaker still finds challenging, with daily reminders that feel like an invitation rather than a nag.',
        outcome: 'Live on Google Play with 100K+ downloads. Demos supported national TV coverage and $31K+ in grants and investment.',
        images: [
          { src: 'assets/img/abjadpolis/city.jpg', alt: 'AbjadPolis: build your city' },
          { src: 'assets/img/abjadpolis/start.jpg', alt: 'Start your Arabic learning adventure' },
          { src: 'assets/img/abjadpolis/exercises.jpg', alt: 'Solve fun exercises: tap the matching pairs' },
          { src: 'assets/img/abjadpolis/conversation.jpg', alt: 'Improve your conversation: speak the word' },
          { src: 'assets/img/abjadpolis/challenges.jpg', alt: 'Beat the challenges' },
          { src: 'assets/img/abjadpolis/knowledge.jpg', alt: 'Test your knowledge: select the correct image' },
          { src: 'assets/img/abjadpolis/stage.jpg', alt: 'Stage completed, piece by piece' },
          { src: 'assets/img/abjadpolis/icon.png', alt: 'AbjadPolis icon', fit: 'contain' },
        ],
        videos: [
          { src: 'assets/video/abjadpolis-trailer.mp4', poster: 'assets/img/abjadpolis/trailer-poster.jpg', alt: 'AbjadPolis trailer', href: PLAY('com.hyphonics.abjadpolis'), source: 'Google Play' },
        ],
        google: G('AbjadPolis Arabic learning game Hyphonics'),
        links: [{ label: 'Google Play', href: PLAY('com.hyphonics.abjadpolis') }],
      },
    ],
  },
];

export const lalapoker = {
  title: 'Lala Poker',
  eyebrow: '04 / THE CARD TABLE',
  headline: ['Real players.', 'Real pressure.'],
  sub: 'A live multiplayer card room I designed and built: Texas Hold’em at the core, with Omaha, Sit & Go, multi-table tournaments, Blackjack, Roulette, a lottery, daily quests, and an avatar marketplace.',
  icon: 'assets/img/lalapoker/icon.png',
  keyArt: 'assets/img/lalapoker/og.jpg',
  features: ['Texas Hold’em', 'Omaha', 'Sit & Go', 'Multi-table tournaments', 'Blackjack', 'Roulette', 'Lala Lottery', 'Daily quests', 'Jackpots', 'VIP tiers', 'Avatar marketplace', 'Cross-platform'],
  stats: [
    { value: '4.6', label: 'App Store rating' },
    { value: '3', label: 'Platforms: iOS · Android · Web' },
    { value: '7', label: 'Game modes' },
  ],
  screenshots: [
    { src: 'assets/img/lalapoker/shot-01.jpg', alt: 'Hold’em table' },
    { src: 'assets/img/lalapoker/shot-14.jpg', alt: 'Omaha' },
    { src: 'assets/img/lalapoker/shot-10.jpg', alt: 'Tournaments' },
    { src: 'assets/img/lalapoker/shot-15.jpg', alt: 'Lobby & lottery' },
    { src: 'assets/img/lalapoker/shot-11.jpg', alt: 'Blackjack' },
    { src: 'assets/img/lalapoker/shot-05.jpg', alt: 'Roulette' },
    { src: 'assets/img/lalapoker/shot-09.jpg', alt: 'Quests' },
    { src: 'assets/img/lalapoker/shot-12.jpg', alt: 'Inventory' },
    { src: 'assets/img/lalapoker/shot-02.jpg', alt: 'Hold’em: check or bet' },
    { src: 'assets/img/lalapoker/shot-03.jpg', alt: 'Lobby' },
    { src: 'assets/img/lalapoker/shot-06.jpg', alt: 'Tournament schedule' },
    { src: 'assets/img/lalapoker/shot-07.jpg', alt: 'Active quest' },
    { src: 'assets/img/lalapoker/shot-08.jpg', alt: 'Blackjack win' },
    { src: 'assets/img/lalapoker/play-poker-hub.jpg', alt: 'Ultimate poker hub' },
    { src: 'assets/img/lalapoker/play-stay-for-lala.jpg', alt: 'Come for poker, stay for Lala' },
  ],
  links: [
    { label: 'App Store', href: 'https://apps.apple.com/us/app/lala-poker/id6461824824' },
    { label: 'Google Play', href: PLAY('com.lalagaming.lalapoker') },
    { label: 'Play in browser', href: 'https://lalapoker.com/' },
  ],
  google: G('Lala Poker app LALAGAMING screenshots'),
};

export const book = {
  eyebrow: '02 / THE FIELD MANUAL',
  titleAr: 'من الفكرة، إلى اللاعب',
  subtitleAr: 'مختصر تصميم الألعاب',
  authorAr: 'زين العابدين قاسم',
  titleEn: 'From idea to player.',
  subtitleEn: 'A short guide to game design',
  badge: 'The only book about game design in Arabic',
  blurb: 'An Arabic guide to thinking like a game designer. The decisions, systems, and player experiences behind the screen, in 30 short chapters you can read in a weekend, with checklists and a card-game exercise you can build yourself.',
  pages: 91,
  pageSrc: (i) => `assets/book/pages/p${String(i).padStart(2, '0')}.jpg`,
  cover: 'assets/book/cover.jpg',
  back: 'assets/book/back.jpg',
  pdf: 'assets/book/Game-Design-Booklet.pdf',
  toc: [
    ['Mechanics', 22], ['Movement dynamics', 26], ['Combat dynamics', 28], ['Aesthetics', 30], ['Game feel', 33],
    ['Level design I & II', 35], ['UI / UX', 39], ['Feedback', 41], ['Economy', 43], ['Reward vs effort', 46],
    ['Narrative', 48], ['World-building', 50], ['Dialogue', 52], ['AI', 54], ['Accessibility', 56], ['Audio & music', 58],
    ['Performance optimization', 60], ['Analytics', 62], ['Iteration', 64], ['Game engines', 67], ['Teamwork', 70],
    ['Production management', 72], ['Ethics', 75], ['Marketing & publishing', 77], ['Case study: Ludo Star', 80],
    ['Card-game exercise', 82], ['Resources', 84], ['Conclusion & notes', 88],
  ],
};

export const ideas = {
  eyebrow: '03 / BEYOND THE BUILD',
  headline: ['Make things.', 'Share the thinking.'],
  review: {
    title: ['“Make it fun.”', 'Okay. But how?'],
    text: 'Game design, player psychology, and the strange relationship between games and real life. In Arabic, in my own words, to 34.6K people who care about how games work.',
  },
  highlights: [
    { label: 'What if', src: 'assets/img/instagram/highlight-what-if.jpg' },
    { label: 'Game mechanics', src: 'assets/img/instagram/highlight-game-mechanics.jpg' },
    { label: '+=-\\', src: 'assets/img/instagram/highlight-plus-equals.jpg' },
    { label: 'Chess', src: 'assets/img/instagram/highlight-chess.jpg' },
  ],
  reels: [
    { date: 'Sep 6, 2026', ar: 'أهم فكرة بتصميم الألعاب', en: 'The one idea that matters most in game design', src: 'assets/img/instagram/september_06_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Sep 2, 2026', ar: 'الألعاب القديمة كانت أحلى! والسبب تلفزيونك', en: 'Old games looked better, and your TV is the reason', src: 'assets/img/instagram/september_02_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 21, 2026', ar: 'ليش الأوبن وورلد مو متل الحقيقة؟', en: 'Open-world games vs reality', src: 'assets/img/instagram/august_21_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 20, 2026', ar: 'الحياة بعيون شخصية من لعبة', en: 'Life through the eyes of a game character', src: 'assets/img/instagram/august_20_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 17, 2026', ar: 'ليش ما بعمل ألعاب Hyper Casual؟', en: 'Why I don’t make hyper-casual games', src: 'assets/img/instagram/august_17_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 12, 2026', ar: 'المتعة مو الهدف! فلسفة تصميم الألعاب', en: 'What does “fun” actually mean?', src: 'assets/img/instagram/august_12_2026.jpg', href: 'https://www.instagram.com/zainkassem000/reel/DcJa2sJsv2K/' },
    { date: 'Aug 9, 2026', ar: 'يوم في حياة مصمم ألعاب في دبي', en: 'A day in the life of a game designer in Dubai', src: 'assets/img/instagram/august_09_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 7, 2026', ar: 'الربح في الألعاب — الجزء 3', en: 'Player time, monetization & The Observer, part 3', src: 'assets/img/instagram/august_07_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 6, 2026', ar: 'كيف تربح من لعبتك — الجزء 2', en: 'How to profit from your game, part 2', src: 'assets/img/instagram/august_06_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 5, 2026', ar: 'كيف تربح من لعبتك — الجزء 1', en: 'How to profit from your game, part 1', src: 'assets/img/instagram/august_05_2026.jpg', href: 'https://www.instagram.com/zainkassem000/' },
    { date: 'Aug 1, 2026', ar: '4 نصائح في تصميم الألعاب', en: '4 game-design tips before you touch the engine', src: 'assets/img/instagram/august_01_2026.jpg', href: 'https://www.instagram.com/zainkassem000/', landscape: true },
    { date: 'Jul 30, 2026', ar: 'نصائح من مصمم ألعاب', en: 'Advice from a game designer, for stronger ideas', src: 'assets/img/instagram/july_30_2026.jpg', href: 'https://www.instagram.com/zainkassem000/', landscape: true },
  ],
};

// ---------------------------------------------------------------- City Crafters spotlight (section #citycrafters)
// `showcase` order matches the four dioramas in js/cityscene.js: pit, holo, blade, jet.
export const citycrafters = {
  eyebrow: 'CITY CRAFTERS · DUBAI · JUL 2024 – JUL 2026',
  headline: ['Head of game design.', 'And the whole floor.'],
  intro: 'Two years leading game and product design at City Crafters, a Dubai studio building VR, mobile, gamification, and branded interactive experiences. I turned business goals and player needs into loops, specs, prototypes, and production plans, then built the team that shipped them.',
  stats: [
    { value: '0 → 12', label: 'Cross-functional team built from scratch: design, engineering, art/UI, QA' },
    { value: '35%', label: 'Faster feature delivery from clearer specs and sprint workflows' },
    { value: '10+', label: 'Branded products architected end to end, from brief to launch' },
    { value: '6', label: 'Synchronized VR stations live at Yas Marina / Abu Dhabi GP activations' },
  ],
  roles: [
    {
      title: 'As Head Game Designer', lead: 'Designing the experience.',
      bullets: [
        'Owned game and product design across mobile, VR, gamification, playable ads, and branded interactive experiences.',
        'Designed the engagement layer clients came for: points economies, tier progression, streaks, leaderboards, gamified onboarding, loyalty loops, and short-session competitive play.',
        'Directed Unseen Blade and Target Destroyed from concept to Google Play: core loops, combat rules, enemy structure, feedback, difficulty curves, session pacing, and player-facing UX.',
        'Iterated everything through playtests, usage data, and stakeholder feedback rather than opinion.',
      ],
    },
    {
      title: 'As team lead', lead: 'Building what’s underneath.',
      bullets: [
        'Hired and grew the founding cross-functional team from 0 to 12, then set the specs and sprint workflows that cut feature-delivery time by 35%.',
        'Owned end-to-end technical solution design for 10+ branded real-time 3D, VR, mobile, and web products: architectures, prototypes, production plans, and delivery priorities.',
        'Coordinated outsourcing and client-facing demonstrations, aligning engineers, artists, designers, and operational stakeholders on integration, performance targets, and production readiness.',
        'Ran live-event operations for Pit Protocol with a demo-ready build delivered in five months and 98% uptime across event days.',
      ],
    },
  ],
  showcase: [
    {
      project: 'pit-protocol', label: 'Pit Protocol', kicker: 'VR · LIVE EVENT',
      did: [
        'Led design and delivery of a distributed VR pit-stop simulator for Yas Marina / Abu Dhabi GP activations with Emaar and Address Hospitality.',
        'Designed the role split so six players read their job in seconds, react to clear feedback, and race the clock together; a live leaderboard kept the crowd coming back.',
        'Delivered a demo-ready build in five months: six synchronized stations, sub-20 ms state sync, and live-event operation at Address Beach Resort.',
      ],
      numbers: [{ value: '6', label: 'synced stations' }, { value: '<20 ms', label: 'state sync' }, { value: '98%', label: 'uptime on event days' }, { value: '5 mo', label: 'to demo-ready' }],
      media: { type: 'video', src: 'assets/video/pit-protocol-day3.mp4', poster: 'assets/img/citycrafters/pit-protocol-day3.jpg', alt: 'Pit Protocol at Address Beach Resort' },
    },
    {
      project: 'hologram-cloud', label: 'Hologram Cloud', kicker: 'REAL-TIME 3D · REAL ESTATE',
      did: [
        'Architected an interactive real-estate visualization platform spanning eight property models, from model-to-runtime workflows to the runtime itself.',
        'Made large environments explorable and responsive with asset streaming and level-of-detail work.',
        'Cut asset load times by 45%; field tests reported +60 NPS.',
      ],
      numbers: [{ value: '8', label: 'property models' }, { value: '−45%', label: 'asset load time' }, { value: '+60', label: 'NPS in field tests' }],
      media: { type: 'image', src: 'assets/img/hxr/holo-wireframe.jpg', alt: 'Holographic wireframe of a building' },
    },
    {
      project: 'unseen-blade', label: 'Unseen Blade', kicker: 'MOBILE · STEALTH ACTION',
      did: [
        'Directed the core loop around one idea: you are blind, and sound is the map. Echo-location turns enemy movement, danger, and hidden paths into things you sense.',
        'Wrote the combat rules, feedback, difficulty progression, and player-facing UX so stealth stays readable without sight, in a feudal Japan with a dark, futuristic edge.',
        'Shipped the first playable version on Google Play in April 2026 with three campaign chapters, story mode, shadow trials, and training grounds.',
      ],
      numbers: [{ value: '3', label: 'campaign chapters' }, { value: 'Apr 2026', label: 'first playable on Google Play' }, { value: '1 hit', label: 'can decide a fight' }],
      media: { type: 'image', src: 'assets/img/unseenblade/02.jpg', alt: 'Unseen Blade: the swordsman on the main menu' },
    },
    {
      project: 'target-destroyed', label: 'Target Destroyed', kicker: 'MOBILE · ARCADE',
      did: [
        'Directed combat rules, enemy structure, session pacing, and HUD feedback for 30-second F-16 sorties that grow with every kill.',
        'Designed the economy and retention loop: smart lock-on, gold high-value targets worth 3x, combo multipliers, Intel Points, hangar upgrades, pilot ranks, daily challenges, and three global leaderboards.',
        'Shipped on Google Play with a FLIR-style military HUD, portrait and landscape play, and 60 fps on modern phones.',
      ],
      numbers: [{ value: '30 s', label: 'sorties, extended by kills' }, { value: '3', label: 'global leaderboards' }, { value: '60 fps', label: 'on modern devices' }],
      media: { type: 'image', src: 'assets/img/targetdestroyed/02.jpg', alt: 'Target Destroyed: missile lock on a drone' },
    },
  ],
};

// ---------------------------------------------------------------- Side quests (section #side-quests)
// DR3 and Gaya Wallet are sister companies of City Crafters (same group). The work happened alongside the City Crafters
// role, which is why the dates overlap; they sit here rather than in the main campaign.
export const sideQuests = {
  eyebrow: 'SIDE QUESTS · SAME GROUP, DIFFERENT DOORS',
  headline: ['Same group.', 'Two more doors.'],
  note: 'DR3 and Gaya Wallet belong to the same group as City Crafters. When those teams needed a hand, I stepped in alongside my City Crafters role, which is why these dates overlap with the main campaign. Smaller chapters, but real production work.',
  companies: [
  {
    id: 'dr3', name: 'DR3', period: 'MAR 2026–PRESENT',
    role: 'Sensing systems · Python · Edge / cloud architecture',
    description: 'Exploring how wireless signals can become useful information about physical spaces.',
    foot: 'Experimental engineering beyond games.',
    cover: '',
    projects: [
      {
        id: 'wifi-sensing', title: 'Wi-Fi sensing platform', tag: 'R&D / PROOF OF CONCEPT', hook: 'Understanding a room through signals.',
        contribution: 'Architected a three-layer sensing, signal-processing, and decision-output platform. Built the Python processing pipeline.',
        challenge: 'Filter noise and drift, select useful sub-carriers, and identify patterns that can support presence and motion-intensity sensing.',
        outcome: 'Working proof of concept for camera-free sensing applications.',
        images: [],
        google: G('WiFi CSI sensing presence detection visualization'),
        links: [],
      },
    ],
  },
  {
    id: 'gaya', name: 'Gaya Wallet', period: 'FEB–OCT 2025',
    role: 'Mobile engineering · React Native · Product integration',
    description: 'Production engineering for Gaya, an AI-powered, multichain, non-custodial Web3 super app: email or social onboarding into an MPC wallet, human-readable @handles, gamified airdrops, staking, automated DCA investing, and a built-in dApp explorer.',
    foot: 'Contributed features to an existing mobile product with 100K+ installs on iOS and Android.',
    cover: 'assets/img/gaya/mobile.jpg',
    site: 'https://gayawallet.com/',
    projects: [
      {
        id: 'multichain-wallet', title: 'Multichain wallet', tag: 'REACT NATIVE / MOBILE', hook: 'Complex transactions. Clear interactions.',
        contribution: 'Built production features covering payments, fiat on-ramp flows, chain integrations, multichain balance aggregation, and swap-routing UX, with secure on-device key management.',
        challenge: 'Make the flow understandable while respecting the requirements of secure key handling and auditable transactions.',
        outcome: 'Production feature work in a security-sensitive codebase with strict review.',
        images: [
          { src: 'assets/img/gaya/mobile.jpg', alt: 'Gaya Wallet on a phone' },
          { src: 'assets/img/gaya/c1.jpg', alt: 'Web2.5 onboarding: sign up with email or social' },
          { src: 'assets/img/gaya/c2.jpg', alt: 'Gaya Quest leaderboard and referrals' },
          { src: 'assets/img/gaya/c3.jpg', alt: 'Protect your wallet with MPC security' },
          { src: 'assets/img/gaya/staking.jpg', alt: 'Staking with multipliers' },
          { src: 'assets/img/gaya/airdrop.jpg', alt: 'Gamified airdrops' },
          { src: 'assets/img/gaya/security.jpg', alt: 'Bank-grade security illustration' },
        ],
        google: G('Gaya Wallet multichain app'),
        links: [{ label: 'gayawallet.com', href: 'https://gayawallet.com/' }],
      },
    ],
  }
  ],
};
