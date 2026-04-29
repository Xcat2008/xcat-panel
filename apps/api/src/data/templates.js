export const templates = [
  {
    id: 'cs2-competitive',
    name: 'CS2 Competitive',
    game: 'cs2',
    description: 'Servidor competitivo pronto a usar com MatchZy.',
    install: {
      commands: [
        'css_readyrequired 1',
        'bot_kick',
        'mp_warmup_end'
      ]
    }
  },
  {
    id: 'cs2-practice',
    name: 'CS2 Practice',
    game: 'cs2',
    description: 'Servidor de treino básico.',
    install: {
      commands: [
        'mp_warmup_start',
        'sv_infinite_ammo 1',
        'bot_kick'
      ]
    }
  }
];

export default templates;
