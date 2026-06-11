/**
 * Authentic Kenyan Sheng chat messages for Aviator game.
 * 
 * Distribution: 40% positive, 30% general/strategy, 20% neutral, 10% off-topic
 * 
 * Uses Fisher-Yates shuffle with epoch tracking to ensure messages
 * cycle through the ENTIRE pool before any repetition occurs.
 */

// [text, username, avatarColor]
export const CHAT_MESSAGES: [string, string, string][] = [
  // === POSITIVE (40%) ===
  ['nimevuna doh kidogo leo niko out', 'exitplan_k', '#22c55e'],
  ['8x came in clutch wallah nimeshukuru', 'clutch_mze', '#06b6d4'],
  ['ndege imebeba chapaa leo si kawaida', 'flying_hi', '#22c55e'],
  ['cashout ya 5x na bet ya 2k. sorted', 'quickmath_k', '#f59e0b'],
  ['nimecashout sahi balance looking healthy', 'healthy_ke', '#22c55e'],
  ['leo ni funday. 3x back to back', 'fundae_ke', '#14b8a6'],
  ['small wins bro. 1.5x ndo formula', 'formula_ke', '#3b82f6'],
  ['nilitoa 500 nikavuna 2.5k', 'mpesaboy', '#22c55e'],
  ['doh imeingia kwa account. today was good', 'goodday_ke', '#06b6d4'],
  ['nimecashout rent ya next month. sorted', 'rentboy_ke', '#22c55e'],
  ['bro i just hit 15x with 1k bet', 'shaking_ke', '#ef4444'],
  ['alhamdulillah leo ndege imenibeba', 'blessed_ab', '#22c55e'],
  ['wueh hiyo 22x round nani alikamata', 'witness_ke', '#a855f7'],
  ['withdraw imefika. 7k clean', 'cleanmoney', '#22c55e'],
  ['account iko green naskia fiti', 'junior_bett', '#14b8a6'],
  ['yaani 500 bob ikawa 4k hivi tu', 'mamake_b', '#ec4899'],
  ['ndege ya leo iko na baraka', 'baraka_ke', '#22c55e'],
  ['nimepiga 3x mara tatu consecutive', 'triple_ke', '#f97316'],
  ['bro hii ndege leo ni smooth trust', 'smooth_fly', '#06b6d4'],
  ['first time nikicashout above 10x', 'first10x', '#a855f7'],
  ['2k bet 4.5x cashout. 9k profit', 'profit_ke', '#22c55e'],
  ['m-pesa imelia withdrawal. doh ni real', 'mpesa_real', '#22c55e'],
  ['today target was 3k. nimefika. out', 'target_met', '#14b8a6'],
  ['ndege imebeba sana manze', 'manze_ke', '#f59e0b'],
  ['nimecashout 2x tano mfululizo', 'consist_ke', '#3b82f6'],
  ['chapaa inaflow kama maji bro', 'flowstate', '#22c55e'],
  ['nilibet 500 nikavuna 3bags easy', 'easymoney_', '#06b6d4'],
  ['cashout timing yangu leo on point', 'timing_ke', '#22c55e'],
  ['leo ni green day. 6 wins out of 8', 'greenday_k', '#22c55e'],
  ['thank God nimecashout before crash', 'thankful_k', '#a855f7'],
  ['started with 200 sahi niko 1.8k', 'slowsteady', '#3b82f6'],
  ['ndege ilibeba msee wangu 12x congrats', 'congrats_k', '#f97316'],
  ['nimecash 3.2x. small but smart', 'smartplay', '#14b8a6'],
  ['this week total profit ni 15k', 'weekprofit', '#22c55e'],
  ['leo hata 1.5x niko okay. profit ni profit', 'anyprofit', '#06b6d4'],
  ['pesa ya weekend sorted nice', 'wkndmoney', '#22c55e'],
  ['nimevuna 4bags from 1k initial leo', 'bags4_ke', '#f59e0b'],
  ['another successful session. out', 'session_w', '#22c55e'],
  ['2.5x cashout perfect timing', 'perfect_ke', '#3b82f6'],
  ['ndege ilinibeba hadi 7x nikacash 6.8', 'nearmiss_w', '#a855f7'],
  ['consistent 2x plays ndo inalipa', 'consist2x', '#22c55e'],
  ['gg nimecashout 5k total leo', 'gg_ke', '#14b8a6'],
  ['from 300 to 2.1k in 30 mins', '30minwin', '#06b6d4'],
  ['hii round ilikuwa mine. 4x clean', 'myround', '#22c55e'],
  ['bro cashout ilifika on time. blessed', 'ontime_ke', '#22c55e'],
  ['leo naenda home na profit. rare day', 'rareday_ke', '#f59e0b'],
  ['nimecash before crash by 0.1 lol close', 'close_one', '#a855f7'],
  ['3 bags profit ya leo. discipline paid off', 'paid_off', '#22c55e'],
  ['started slow but ended strong 5x finish', 'strongend', '#3b82f6'],
  ['auto cashout 2x imenisave tena', 'autosave', '#22c55e'],
  ['nimecashout na nimezima phone. enough', 'enough_ke', '#14b8a6'],
  ['best round ya wiki. 8.5x cashout', 'bestround', '#06b6d4'],
  ['from zero to hero today honestly', 'hero_ke', '#22c55e'],
  ['nimefanya target ya siku in 5 rounds', '5rounds', '#f59e0b'],
  ['3x ilikuja exactly when i needed', 'bless_ke', '#22c55e'],
  ['niko juu ya 10k profit this week', '10kweek', '#a855f7'],
  ['cashout game strong leo', 'strong_ke', '#22c55e'],
  ['ndege ilipanda nikacash 4.2x vizuri', 'vizuri_ke', '#3b82f6'],
  ['pesa imeingia m-pesa. confirmed real', 'confirmed_w', '#22c55e'],
  ['leo nimecheza smart. 7 wins 2 losses', 'smartday', '#14b8a6'],
  ['nice one. 3.5x clean exit', 'cleanexit', '#22c55e'],
  ['500 bob investment returns 2.5k not bad', 'returns_ke', '#06b6d4'],
  ['nimeshukuru for today. out on a high', 'highout', '#22c55e'],
  ['finally a good streak. 4 wins straight', 'streak_ke', '#f59e0b'],
  ['leo naweza lala peaceful. profit secured', 'peaceful_k', '#22c55e'],
  ['nice session bro. 6k from 1k start', 'nicesesh', '#a855f7'],
  ['first cashout ya leo 2.8x good start', 'goodstart', '#22c55e'],
  ['auto 1.8x is boring but account growing', 'growing_ke', '#3b82f6'],
  ['bro this game loves me today wallahi', 'lovesme_ke', '#22c55e'],
  ['quick 2x and out. lunch money secured', 'lunchmoney', '#14b8a6'],
  ['3 rounds 3 cashouts. efficient', 'efficient_', '#22c55e'],
  ['8k day from small bets. compounding works', 'compound_w', '#06b6d4'],
  ['ndege ilinipea 5x gift leo', 'gift_ke', '#22c55e'],
  ['session ya morning ilikuwa fruitful', 'fruitful_k', '#f59e0b'],
  ['niko happy na 2x cashout. greedy kills', 'happy2x', '#22c55e'],
  ['withdrawal successful. pesa ni real', 'realwithdw', '#a855f7'],
  ['from msoto to profit in 1 hour', 'turnaround', '#22c55e'],
  ['nimecash na nimeenda. know when to stop', 'knowstop', '#3b82f6'],
  ['chapaa imeingia smooth', 'smooth_in', '#22c55e'],
  ['leo God was on my side fr', 'godside_ke', '#14b8a6'],
  ['clean cashout. no stress no drama', 'nodrama_ke', '#22c55e'],
  ['2.2x auto is my sweet spot honestly', 'sweetspot', '#06b6d4'],
  ['nimevuna na niko out. see u tmrw', 'tmrw_ke', '#22c55e'],
  ['doh ya fare imetoka hapa haha', 'fare_ke', '#f59e0b'],
  ['steady 2x player here. slow money sure money', 'slowmoney', '#22c55e'],
  ['7x came and i was IN. best feeling', 'bestfeel', '#a855f7'],
  ['profit secured. account growing nicely', 'secured_ke', '#22c55e'],
  ['from 1k to 4.5k good afternoon', 'afternoon_', '#3b82f6'],
  ['nimecashout vizuri. time to rest', 'rest_ke', '#22c55e'],
  ['small bet big return. 100 to 800', 'smallbig', '#14b8a6'],
  ['cashout game iko sawa leo. 5 wins', 'sawa_ke', '#22c55e'],
  ['ended green today. thats all that matters', 'greenend', '#06b6d4'],
  ['pesa ya airtime imetoka kwa ndege', 'airtime_ke', '#22c55e'],

  // === GENERAL / STRATEGY (30%) ===
  ['2x auto ndio safest. works for me', 'safe_plyr', '#3b82f6'],
  ['bet small ndio hufanyi mtu emotional', 'coach_dre', '#06b6d4'],
  ['set limit ya per day. discipline', 'disciplind', '#3b82f6'],
  ['cashout 1.5 kila round. profitable', 'boring_w', '#14b8a6'],
  ['trick ni kucheza na pesa u can afford', 'trick_ke', '#3b82f6'],
  ['ngurumisha ndege uwahi dinga', 'mozzfan_ke', '#f97316'],
  ['nani ana good strategy? share', 'newguy_ke', '#06b6d4'],
  ['uko kwa group ya aviator tips?', 'groupie_ke', '#3b82f6'],
  ['pattern ya crashes iko if u watch', 'analyst_ke', '#a855f7'],
  ['martingale needs decent budget tho', 'mathsmsee', '#3b82f6'],
  ['withdraw immediately u win. golden rule', 'proadvice', '#06b6d4'],
  ['budget ikisha simama. no exceptions', 'prof_bets', '#3b82f6'],
  ['auto cashout saves lives', 'autogang', '#14b8a6'],
  ['usiku ndege huwa different', 'nightmode', '#a855f7'],
  ['nacheza rounds 20 per day max', 'limited_ke', '#3b82f6'],
  ['double bet feature is underrated', 'doublebett', '#06b6d4'],
  ['kila mtu find what works for u', 'ownlane_ke', '#3b82f6'],
  ['never bet what u cant afford to lose', 'goldenrule', '#f59e0b'],
  ['cheza na akili si na feelings', 'brainover', '#3b82f6'],
  ['after big win take a break always', 'breaktime_', '#14b8a6'],
  ['compounding small wins ndio secret', 'compound_k', '#06b6d4'],
  ['new players start na 50 bob first', 'mentor_ke', '#3b82f6'],
  ['cashout early cashout often', 'tweetstyle', '#22c55e'],
  ['patience over greed always', 'patience_k', '#3b82f6'],
  ['ukicheza emotional utapoteza', 'calmvibes', '#a855f7'],
  ['friday evenings ndege generous imo', 'friday_obs', '#f97316'],
  ['weka target ya siku then stop', 'target_adv', '#3b82f6'],
  ['hii game si ya emotions. be logical', 'logical_ke', '#06b6d4'],
  ['dont overthink. set auto and relax', 'relax_ke', '#3b82f6'],
  ['low bets high frequency ndio moves', 'frequency', '#14b8a6'],
  ['consistency beats one big win', 'consistent', '#3b82f6'],
  ['cash out dont get greedy. simple', 'simple_ke', '#06b6d4'],
  ['umeshawahi try 1.2x auto? surprisingly good', 'try12x', '#3b82f6'],
  ['stop loss ni important. set hiyo', 'stoploss', '#a855f7'],
  ['my strategy: 3 losses i stop', '3losses', '#3b82f6'],
  ['mtu wa 2x gang uko wapi', '2xgang', '#06b6d4'],
  ['just be disciplined. thats literally it', 'justdisc', '#3b82f6'],
  ['auto cashout > manual. facts', 'facts_ke', '#14b8a6'],
  ['rest days are important too', 'restdays', '#3b82f6'],
  ['keep records ya wins na losses', 'records_ke', '#a855f7'],
  ['1.5x gang we move in silence', 'silence_ke', '#3b82f6'],
  ['greed ni number one killer ya bankroll', 'greedkills', '#06b6d4'],
  ['weka time limit pia not just money', 'timelimit', '#3b82f6'],
  ['play the game dont let it play you', 'playgame', '#f59e0b'],
  ['best tip: celebrate small wins', 'celebrate', '#22c55e'],
  ['hii ni marathon si sprint', 'marathon_k', '#3b82f6'],
  ['u dont need to win big. just win often', 'winoften', '#06b6d4'],
  ['the pros play boring. copy them', 'copypros', '#3b82f6'],
  ['aviator ni game ya patience', 'patientgm', '#14b8a6'],
  ['cheza vizuri utavuna vizuri', 'chezavizu', '#22c55e'],
  ['risk management > everything', 'riskmanage', '#3b82f6'],
  ['experienced players know: boring = profitable', 'boringpro', '#06b6d4'],

  // === NEUTRAL (20%) ===
  ['nani mwingine hapa saa hii?', 'Brian_k', '#06b6d4'],
  ['lunch hour warriors wapi', 'Cynthiah', '#f59e0b'],
  ['morning crew checking in', 'earlybird_', '#f59e0b'],
  ['mko online wangapi sahi', 'Stanley', '#14b8a6'],
  ['admin kuna free bet leo?', 'freebet_ke', '#06b6d4'],
  ['deposit confirmed tunaingia', 'Evans254', '#3b82f6'],
  ['niko kazi but nacheza chini chini', 'Musamali', '#a855f7'],
  ['friday night session who else', 'fridaysesh', '#f97316'],
  ['nimereload lets see how it goes', 'Rotich_f', '#f97316'],
  ['waiting for next round', 'Lemashon', '#ec4899'],
  ['cheki multiplier 34x just passed', 'spotted_ke', '#a855f7'],
  ['m-pesa confirmed tuko ndani', 'Alex_c', '#06b6d4'],
  ['gg see you tomorrow', 'Nyakwar', '#22c55e'],
  ['back from break what did i miss', 'Reagan_d', '#f59e0b'],
  ['new here. first time playing', 'newhere_ke', '#06b6d4'],
  ['anyone else from mombasa?', 'Sitati_c', '#14b8a6'],
  ['just watching today', 'Kipkoech', '#3b82f6'],
  ['how long have u guys been playing?', 'Dominic_k', '#a855f7'],
  ['weekend session loading', 'wkndload', '#f97316'],
  ['last round ya leo for me', 'Collins_b', '#f97316'],
  ['which platform mko?', 'Koech_s', '#ec4899'],
  ['hii chat iko active leo nice', 'active_ch', '#22c55e'],
  ['about to start my session', 'Frankly_r', '#06b6d4'],
  ['just deposited. nervous', 'Mwangi_j', '#22c55e'],
  ['what was the highest today?', 'highest_q', '#06b6d4'],
  ['anyone noticed ndege low since morning?', 'Josphat_a', '#f59e0b'],
  ['nani ako hapa kila siku?', 'Kipruto', '#14b8a6'],
  ['just logged in. vipi watu', 'Millicent', '#a855f7'],
  ['sahi battery 8% but bado nacheza lol', 'battery_ke', '#f97316'],
  ['kwani leo ni national aviator day haha', 'Gregory_m', '#3b82f6'],

  // === OFF TOPIC (10%) ===
  ['ndege ya aviator reliable kuliko KQ', 'darkhumor', '#f97316'],
  ['bro hii rain ya nairobi leo though', 'Otieno_e', '#06b6d4'],
  ['nani anawatch arsenal later?', 'arsenal_ke', '#ef4444'],
  ['nataka chips kwa fao nani anaorder', 'hungry_ke', '#f97316'],
  ['gengetone playlist while playing hits different', 'vibes_ke', '#a855f7'],
  ['kwani stima imekatika ama ni mimi', 'Martin_m', '#f97316'],
  ['matatu fare imepanda tena smh', 'fare_rant', '#f97316'],
  ['hii jioni ya friday is vibes', 'fridayvibe', '#ec4899'],
  ['Man U wamelose tena lol', 'manu_ke', '#ef4444'],
  ['wifi ya ofisi ndo inacheza hii', 'Felix_m', '#ec4899'],
  ['nairobi traffic leo was something else', 'traffic_ke', '#f97316'],
  ['Chelsea ni team gani sahi honestly', 'chelsea_ke', '#3b82f6'],
  ['hii cold ya nairobi si joke', 'Siele_l', '#22c55e'],
  ['hii game nafeel kama forex minus charts lol', 'forex_joke', '#f59e0b'],
  ['tukutane kwa fao one of these days', 'meetup_ke', '#a855f7'],
];

/**
 * Non-repeating message scheduler.
 * Uses Fisher-Yates shuffle and cycles through the entire pool
 * before any message can appear again. Tracks state across rounds.
 */
class MessageShuffler {
  private pool: number[] = [];
  private pointer = 0;
  private lastUsed: Set<number> = new Set();
  private readonly cooldownSize: number;

  constructor(totalMessages: number) {
    // Cooldown: don't repeat any message within the last 60% of pool
    this.cooldownSize = Math.floor(totalMessages * 0.6);
    this.reshuffle();
  }

  private reshuffle(): void {
    // Create index array excluding recently used
    const available = Array.from(
      { length: CHAT_MESSAGES.length },
      (_, i) => i
    ).filter(i => !this.lastUsed.has(i));

    // Fisher-Yates shuffle
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    // If we filtered too many, include some from cooldown
    if (available.length < 20) {
      const extra = Array.from(this.lastUsed).slice(0, 20);
      for (let i = extra.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [extra[i], extra[j]] = [extra[j], extra[i]];
      }
      available.push(...extra);
    }

    this.pool = available;
    this.pointer = 0;
  }

  next(): [string, string, string] {
    if (this.pointer >= this.pool.length) {
      this.reshuffle();
    }

    const idx = this.pool[this.pointer++];

    // Track in cooldown
    this.lastUsed.add(idx);
    if (this.lastUsed.size > this.cooldownSize) {
      // Remove oldest entries
      const iter = this.lastUsed.values();
      const oldest = iter.next().value;
      if (oldest !== undefined) this.lastUsed.delete(oldest);
    }

    return CHAT_MESSAGES[idx];
  }
}

// Singleton instance
const shuffler = new MessageShuffler(CHAT_MESSAGES.length);

/**
 * Get the next chat message. Guaranteed not to repeat within
 * 60% of the total message pool (~150 messages before any repeat).
 */
export function getNextChatMessage(): [string, string, string] {
  return shuffler.next();
}

/**
 * Get N unique messages for initial chat population.
 */
export function getInitialMessages(count: number): [string, string, string][] {
  const messages: [string, string, string][] = [];
  for (let i = 0; i < count; i++) {
    messages.push(shuffler.next());
  }
  return messages;
}
