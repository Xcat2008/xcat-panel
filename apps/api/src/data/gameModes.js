const gameModes = [
  {
    id: 'competitive',
    name: 'Competitive / War',
    category: 'PCW',
    description: 'Modo competitivo com MatchZy ativo, ready system e configs de guerra.',
    available: true,
    restartRequired: true,
    pluginProfile: {
      matchzy: true,
      gungame: false,
      retakes: false
    },
    defaultSettings: {
      maxPlayers: 11,
      botQuota: 0,
      tvSlots: 1,
      gameType: 0,
      gameMode: 1
    },
    defaultMap: 'de_mirage',
    mapPool: ['de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis', 'de_dust2'],
    commands: [
      'exec GameForgeModes/competitive.cfg',
      'css_readyrequired 1',
      'bot_kick',
      'mp_warmup_end'
    ]
  },
  {
    id: 'aim',
    name: 'Aim / Training',
    category: 'Training',
    description: 'Modo treino/aim livre. MatchZy desligado para não pedir ready/unready.',
    available: true,
    restartRequired: true,
    pluginProfile: {
      matchzy: false,
      gungame: false,
      retakes: false
    },
    defaultSettings: {
      maxPlayers: 16,
      botQuota: 0,
      tvSlots: 1,
      gameType: 0,
      gameMode: 0
    },
    defaultMap: 'de_dust2',
    mapPool: ['de_dust2', 'de_mirage', 'de_inferno'],
    commands: [
      'exec GameForgeModes/aim.cfg'
    ]
  },
  {
    id: 'fun',
    name: 'Mini Maps / Fun',
    category: 'Fun',
    description: 'Modo casual/fun para mapas pequenos. MatchZy desligado para não interferir.',
    available: true,
    restartRequired: true,
    pluginProfile: {
      matchzy: false,
      gungame: false,
      retakes: false
    },
    defaultSettings: {
      maxPlayers: 18,
      botQuota: 0,
      tvSlots: 1,
      gameType: 0,
      gameMode: 0
    },
    defaultMap: 'de_dust2',
    mapPool: ['de_dust2', 'de_mirage', 'de_inferno'],
    commands: [
      'exec GameForgeModes/fun.cfg'
    ]
  },
  {
    id: 'retakes',
    name: 'Retakes',
    category: 'Training',
    description: 'Modo pós-plant/retakes. Requer plugin Retakes CS2.',
    requiresPlugin: 'retakes',
    available: true,
    restartRequired: true,
    pluginProfile: {
      matchzy: false,
      gungame: false,
      retakes: true
    },
    defaultSettings: {
      maxPlayers: 11,
      botQuota: 0,
      tvSlots: 1,
      gameType: 0,
      gameMode: 0
    },
    defaultMap: 'de_mirage',
    mapPool: ['de_mirage', 'de_inferno', 'de_nuke', 'de_ancient', 'de_anubis'],
    commands: [
      'exec GameForgeModes/retakes.cfg'
    ]
  }
];

export default gameModes;
