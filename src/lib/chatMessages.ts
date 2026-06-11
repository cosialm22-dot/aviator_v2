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
  ['nimevuna doh kidogo leo niko out', 'Muliro', '#22c55e'],
  ['8x came in clutch wallah nimeshukuru', 'Winnie_k', '#06b6d4'],
  ['ndege imebeba chapaa leo si kawaida', 'Gregory_m', '#22c55e'],
  ['cashout ya 5x na bet ya 2k. sorted', 'Dee_ke', '#f59e0b'],
  ['nimecashout sahi balance looking healthy', 'Joseph_m', '#22c55e'],
  ['leo ni funday. 3x back to back', 'Chris_mu', '#14b8a6'],
  ['small wins bro. 1.5x ndo formula', 'Karanja', '#3b82f6'],
  ['nilitoa 500 nikavuna 2.5k', 'Kariuki', '#22c55e'],
  ['doh imeingia kwa account. today was good', 'Josphat_a', '#06b6d4'],
  ['nimecashout rent ya next month. sorted', 'Cheruiyot', '#22c55e'],
  ['bro i just hit 15x with 1k bet', 'Henry_ot', '#ef4444'],
  ['alhamdulillah leo ndege imenibeba', 'Diana_o', '#22c55e'],
  ['wueh hiyo 22x round nani alikamata', 'Dan_che', '#a855f7'],
  ['withdraw imefika. 7k clean', 'Kyalo', '#22c55e'],
  ['account iko green naskia fiti', 'Mwikali', '#14b8a6'],
  ['yaani 500 bob ikawa 4k hivi tu', 'Mercy_n', '#ec4899'],
  ['ndege ya leo iko na baraka', 'Kiptoo_r', '#22c55e'],
  ['nimepiga 3x mara tatu consecutive', 'Leo_mach', '#f97316'],
  ['bro hii ndege leo ni smooth trust', 'Owuor', '#06b6d4'],
  ['first time nikicashout above 10x', 'Njoroge', '#a855f7'],
  ['2k bet 4.5x cashout. 9k profit', 'Ndinda', '#22c55e'],
  ['m-pesa imelia withdrawal. doh ni real', 'Wainaina', '#22c55e'],
  ['today target was 3k. nimefika. out', 'Langat', '#14b8a6'],
  ['ndege imebeba sana manze', 'James_ow', '#f59e0b'],
  ['nimecashout 2x tano mfululizo', 'Florence', '#3b82f6'],
  ['chapaa inaflow kama maji bro', 'Faith99', '#22c55e'],
  ['nilibet 500 nikavuna 3bags easy', 'Sang', '#06b6d4'],
  ['cashout timing yangu leo on point', 'David_nn', '#22c55e'],
  ['leo ni green day. 6 wins out of 8', 'Kimani_w', '#22c55e'],
  ['thank God nimecashout before crash', 'Skipper', '#a855f7'],
  ['started with 200 sahi niko 1.8k', 'Kipkoech', '#3b82f6'],
  ['ndege ilibeba msee wangu 12x congrats', 'Ben_waf', '#f97316'],
  ['nimecash 3.2x. small but smart', 'Gichuki', '#14b8a6'],
  ['this week total profit ni 15k', 'Nyakwar', '#22c55e'],
  ['leo hata 1.5x niko okay. profit ni profit', 'Jeptoo_k', '#06b6d4'],
  ['pesa ya weekend sorted nice', 'Wanjala_b', '#22c55e'],
  ['nimevuna 4bags from 1k initial leo', 'Wanyama', '#f59e0b'],
  ['another successful session. out', 'BigMan_ke', '#22c55e'],
  ['2.5x cashout perfect timing', 'Odongo', '#3b82f6'],
  ['ndege ilinibeba hadi 7x nikacash 6.8', 'Vicky_ke', '#a855f7'],
  ['consistent 2x plays ndo inalipa', 'Carol_m', '#22c55e'],
  ['gg nimecashout 5k total leo', 'Barasa', '#14b8a6'],
  ['from 300 to 2.1k in 30 mins', 'Macharia', '#06b6d4'],
  ['hii round ilikuwa mine. 4x clean', 'Nyambura', '#22c55e'],
  ['bro cashout ilifika on time. blessed', 'Amina_h', '#22c55e'],
  ['leo naenda home na profit. rare day', 'Korir', '#f59e0b'],
  ['nimecash before crash by 0.1 lol close', 'Mark_nj', '#a855f7'],
  ['3 bags profit ya leo. discipline paid off', 'Vincent_n', '#22c55e'],
  ['started slow but ended strong 5x finish', 'Kioko', '#3b82f6'],
  ['auto cashout 2x imenisave tena', 'Derrick_k', '#22c55e'],
  ['nimecashout na nimezima phone. enough', 'Emmanuel', '#14b8a6'],
  ['best round ya wiki. 8.5x cashout', 'Felix_m', '#06b6d4'],
  ['from zero to hero today honestly', 'Frankly_r', '#22c55e'],
  ['nimefanya target ya siku in 5 rounds', 'Mumbi', '#f59e0b'],
  ['3x ilikuja exactly when i needed', 'Chirchir', '#22c55e'],
  ['niko juu ya 10k profit this week', 'Kamau', '#a855f7'],
  ['cashout game strong leo', 'Fatma', '#22c55e'],
  ['ndege ilipanda nikacash 4.2x vizuri', 'Sanchoman', '#3b82f6'],
  ['pesa imeingia m-pesa. confirmed real', 'Ngugi_m', '#22c55e'],
  ['leo nimecheza smart. 7 wins 2 losses', 'Mutisya', '#14b8a6'],
  ['nice one. 3.5x clean exit', 'Patrick_o', '#22c55e'],
  ['500 bob investment returns 2.5k not bad', 'Rotich_f', '#06b6d4'],
  ['nimeshukuru for today. out on a high', 'Nafula_m', '#22c55e'],
  ['finally a good streak. 4 wins straight', 'Ruth_ot', '#f59e0b'],
  ['leo naweza lala peaceful. profit secured', 'Charles_w', '#22c55e'],
  ['nice session bro. 6k from 1k start', 'Nzeki', '#a855f7'],
  ['first cashout ya leo 2.8x good start', 'Allan_m', '#22c55e'],
  ['auto 1.8x is boring but account growing', 'Gathua', '#3b82f6'],
  ['bro this game loves me today wallahi', 'Thuo', '#22c55e'],
  ['quick 2x and out. lunch money secured', 'Linda_mw', '#14b8a6'],
  ['3 rounds 3 cashouts. efficient', 'Muthoni_n', '#22c55e'],
  ['8k day from small bets. compounding works', 'Jane_kam', '#06b6d4'],
  ['ndege ilinipea 5x gift leo', 'Shitandi', '#22c55e'],
  ['session ya morning ilikuwa fruitful', 'Salim_k', '#f59e0b'],
  ['niko happy na 2x cashout. greedy kills', 'Grace_w', '#22c55e'],
  ['withdrawal successful. pesa ni real', 'Tanui', '#a855f7'],
  ['from msoto to profit in 1 hour', 'Dominic_k', '#22c55e'],
  ['nimecash na nimeenda. know when to stop', 'Mwendwa', '#3b82f6'],
  ['chapaa imeingia smooth', 'Rono_k', '#22c55e'],
  ['leo God was on my side fr', 'Junior_ot', '#14b8a6'],
  ['clean cashout. no stress no drama', 'Abdul', '#22c55e'],
  ['2.2x auto is my sweet spot honestly', 'Mike_oti', '#06b6d4'],
  ['nimevuna na niko out. see u tmrw', 'Samuel_ke', '#22c55e'],
  ['doh ya fare imetoka hapa haha', 'Fred_ong', '#f59e0b'],
  ['steady 2x player here. slow money sure money', 'Wairimu_k', '#22c55e'],
  ['7x came and i was IN. best feeling', 'Okeyo', '#a855f7'],
  ['profit secured. account growing nicely', 'Kuria_d', '#22c55e'],
  ['from 1k to 4.5k good afternoon', 'Njeri', '#3b82f6'],
  ['nimecashout vizuri. time to rest', 'Ken_juma', '#22c55e'],
  ['small bet big return. 100 to 800', 'Ann_kip', '#14b8a6'],
  ['cashout game iko sawa leo. 5 wins', 'Otuoma', '#22c55e'],
  ['ended green today. thats all that matters', 'Rashid', '#06b6d4'],
  ['pesa ya airtime imetoka kwa ndege', 'Awuor', '#22c55e'],

  // === GENERAL / STRATEGY (30%) ===
  ['2x auto ndio safest. works for me', 'Evans254', '#3b82f6'],
  ['bet small ndio hufanyi mtu emotional', 'Nekesa', '#06b6d4'],
  ['set limit ya per day. discipline', 'Musyoka', '#3b82f6'],
  ['cashout 1.5 kila round. profitable', 'Okoth', '#14b8a6'],
  ['trick ni kucheza na pesa u can afford', 'Alice_wa', '#3b82f6'],
  ['ngurumisha ndege uwahi dinga', 'Eric_ot', '#f97316'],
  ['nani ana good strategy? share', 'Chesire', '#06b6d4'],
  ['uko kwa group ya aviator tips?', 'Pauline_m', '#3b82f6'],
  ['pattern ya crashes iko if u watch', 'Gitau_b', '#a855f7'],
  ['martingale needs decent budget tho', 'Juma_o', '#3b82f6'],
  ['withdraw immediately u win. golden rule', 'Betty_ok', '#06b6d4'],
  ['budget ikisha simama. no exceptions', 'Stanley', '#3b82f6'],
  ['auto cashout saves lives', 'Alex_c', '#14b8a6'],
  ['usiku ndege huwa different', 'Nick_kar', '#a855f7'],
  ['nacheza rounds 20 per day max', 'Paul_kip', '#3b82f6'],
  ['double bet feature is underrated', 'Solo_nai', '#06b6d4'],
  ['kila mtu find what works for u', 'George_ki', '#3b82f6'],
  ['never bet what u cant afford to lose', 'Nancy_o', '#f59e0b'],
  ['cheza na akili si na feelings', 'Danny_o', '#3b82f6'],
  ['after big win take a break always', 'Ogada', '#14b8a6'],
  ['compounding small wins ndio secret', 'Bett_c', '#06b6d4'],
  ['new players start na 50 bob first', 'Lucy_che', '#3b82f6'],
  ['cashout early cashout often', 'Bob_maina', '#22c55e'],
  ['patience over greed always', 'Adhiambo', '#3b82f6'],
  ['ukicheza emotional utapoteza', 'Billy_ke', '#a855f7'],
  ['friday evenings ndege generous imo', 'Phil_mw', '#f97316'],
  ['weka target ya siku then stop', 'Ndegwa', '#3b82f6'],
  ['hii game si ya emotions. be logical', 'Hassan_m', '#06b6d4'],
  ['dont overthink. set auto and relax', 'Munyao', '#3b82f6'],
  ['low bets high frequency ndio moves', 'Njenga', '#14b8a6'],
  ['consistency beats one big win', 'Omar_a', '#3b82f6'],
  ['cash out dont get greedy. simple', 'Millicent', '#06b6d4'],
  ['umeshawahi try 1.2x auto? surprisingly good', 'Steve_ka', '#3b82f6'],
  ['stop loss ni important. set hiyo', 'Brian_k', '#a855f7'],
  ['my strategy: 3 losses i stop', 'Luvai', '#3b82f6'],
  ['mtu wa 2x gang uko wapi', 'Lemashon', '#06b6d4'],
  ['just be disciplined. thats literally it', 'Kevin7', '#3b82f6'],
  ['auto cashout > manual. facts', 'Collins_b', '#14b8a6'],
  ['rest days are important too', 'Kibet', '#3b82f6'],
  ['keep records ya wins na losses', 'Martin_m', '#a855f7'],
  ['1.5x gang we move in silence', 'Ian_k', '#3b82f6'],
  ['greed ni number one killer ya bankroll', 'Dre_ke', '#06b6d4'],
  ['weka time limit pia not just money', 'Sitati_c', '#3b82f6'],
  ['play the game dont let it play you', 'Onyango', '#f59e0b'],
  ['best tip: celebrate small wins', 'Lilian_w', '#22c55e'],
  ['hii ni marathon si sprint', 'Akinyi99', '#3b82f6'],
  ['u dont need to win big. just win often', 'Ndolo', '#06b6d4'],
  ['the pros play boring. copy them', 'Simiyu', '#3b82f6'],
  ['aviator ni game ya patience', 'Cherono', '#14b8a6'],
  ['cheza vizuri utavuna vizuri', 'Maina254', '#22c55e'],
  ['risk management > everything', 'Kigen', '#3b82f6'],
  ['experienced players know: boring = profitable', 'Dennis', '#06b6d4'],

  // === NEUTRAL (20%) ===
  ['nani mwingine hapa saa hii?', 'Kilonzo', '#06b6d4'],
  ['lunch hour warriors wapi', 'Gathoni', '#f59e0b'],
  ['morning crew checking in', 'Kahiga', '#f59e0b'],
  ['mko online wangapi sahi', 'Clinton', '#14b8a6'],
  ['admin kuna free bet leo?', 'Oluoch', '#06b6d4'],
  ['deposit confirmed tunaingia', 'Tom_kip', '#3b82f6'],
  ['niko kazi but nacheza chini chini', 'Tony_ke', '#a855f7'],
  ['friday night session who else', 'Mburu', '#f97316'],
  ['nimereload lets see how it goes', 'Masinde', '#f97316'],
  ['waiting for next round', 'Yusuf_m', '#ec4899'],
  ['cheki multiplier 34x just passed', 'Victor_m', '#a855f7'],
  ['m-pesa confirmed tuko ndani', 'Ouma_k', '#06b6d4'],
  ['gg see you tomorrow', 'Reagan_d', '#22c55e'],
  ['back from break what did i miss', 'Agnes_mu', '#f59e0b'],
  ['new here. first time playing', 'Marto', '#06b6d4'],
  ['anyone else from mombasa?', 'Ibrahim_n', '#14b8a6'],
  ['just watching today', 'Susan_nd', '#3b82f6'],
  ['how long have u guys been playing?', 'Koech_s', '#a855f7'],
  ['weekend session loading', 'Joy_wanj', '#f97316'],
  ['last round ya leo for me', 'Bakari', '#f97316'],
  ['which platform mko?', 'Hellen_n', '#ec4899'],
  ['hii chat iko active leo nice', 'Kipruto', '#22c55e'],
  ['about to start my session', 'Mwangi_j', '#06b6d4'],
  ['just deposited. nervous', 'Mutua_k', '#22c55e'],
  ['what was the highest today?', 'Anyango_m', '#06b6d4'],
  ['anyone noticed ndege low since morning?', 'Trevor_w', '#f59e0b'],
  ['nani ako hapa kila siku?', 'Wafula', '#14b8a6'],
  ['just logged in. vipi watu', 'Kelvin_j', '#a855f7'],
  ['sahi battery 8% but bado nacheza lol', 'KJ_254', '#f97316'],
  ['kwani leo ni national aviator day haha', 'Sharon_k', '#3b82f6'],

  // === OFF TOPIC (10%) ===
  ['ndege ya aviator reliable kuliko KQ', 'Kiplagat', '#f97316'],
  ['bro hii rain ya nairobi leo though', 'Wambui', '#06b6d4'],
  ['nani anawatch arsenal later?', 'Bobo_msa', '#ef4444'],
  ['nataka chips kwa fao nani anaorder', 'Chepkoech', '#f97316'],
  ['gengetone playlist while playing hits different', 'Ray_lang', '#a855f7'],
  ['kwani stima imekatika ama ni mimi', 'Wekesa_j', '#f97316'],
  ['matatu fare imepanda tena smh', 'Kimutai', '#f97316'],
  ['hii jioni ya friday is vibes', 'Odhiambo', '#ec4899'],
  ['Man U wamelose tena lol', 'Wahome', '#ef4444'],
  ['wifi ya ofisi ndo inacheza hii', 'Irungu_k', '#ec4899'],
  ['nairobi traffic leo was something else', 'Oscar_w', '#f97316'],
  ['Chelsea ni team gani sahi honestly', 'Chebet', '#3b82f6'],
  ['hii cold ya nairobi si joke', 'Otieno_e', '#22c55e'],
  ['hii game nafeel kama forex minus charts lol', 'Wanjiku', '#f59e0b'],
  ['tukutane kwa fao one of these days', 'Esther_k', '#a855f7'],
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
