// ============================================================
// 大学英语四六级单词背诵 APP - 核心逻辑
// ============================================================

(function () {
  "use strict";

  // ---- 数据 ----
  const WORDS = window.WORD_DATA.ALL_WORDS;
  const CET4 = window.WORD_DATA.CET4_WORDS;
  const CET6 = window.WORD_DATA.CET6_WORDS;

  // 给每个单词标记级别
  CET4.forEach(w => { w.level = "CET-4"; });
  CET6.forEach(w => { w.level = "CET-6"; });

  // ---- 艾宾浩斯遗忘曲线复习间隔（分钟）----
  const REVIEW_INTERVALS = [
    5,        // 第1次：5分钟后
    30,       // 第2次：30分钟后
    720,      // 第3次：12小时后
    1440,     // 第4次：1天后
    4320,     // 第5次：3天后
    10080,    // 第6次：7天后
    21600,    // 第7次：15天后
    43200,    // 第8次：30天后
  ];

  const STORAGE_KEY = "cet_word_app_data_v1";
  const DAILY_GOAL = 20; // 每日新词目标

  // ---- 应用状态 ----
  let state = {
    currentLevel: "CET-4", // CET-4 | CET-6
    currentPage: "dashboard",
    // 学习进度数据（持久化）
    progress: {},
  };

  // 学习会话临时状态
  let session = {
    mode: null,        // learn | quiz | spell
    queue: [],         // 当前学习队列
    index: 0,          // 当前位置
    flipped: false,    // 卡片是否翻转
    quizAnswered: false,
    quizCorrect: 0,
    quizWrong: 0,
    spellRevealed: false,
    learnStats: { known: 0, fuzzy: 0, unknown: 0 },
  };

  // ---- 数据持久化 ----
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state.progress = JSON.parse(raw);
      }
    } catch (e) {
      console.warn("加载进度失败", e);
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
      // 触发云端同步（节流）
      if (window.cetSync && cetSync.hasToken()) {
        cetSync.scheduleSync(() => state.progress);
      }
    } catch (e) {
      console.warn("保存进度失败", e);
    }
  }

  // ---- 单词进度管理 ----
  function getWordProgress(word) {
    const key = `${state.currentLevel}:${word}`;
    if (!state.progress[key]) {
      state.progress[key] = {
        level: state.currentLevel,
        word: word,
        stage: 0,          // 0=新词, 1-8=复习阶段
        mastery: "new",    // new | learning | mastered
        reviewCount: 0,
        lastReview: null,
        nextReview: null,
        knownCount: 0,
        fuzzyCount: 0,
        unknownCount: 0,
        firstLearn: null,
      };
    }
    return state.progress[key];
  }

  function getWordsForLevel(level) {
    return level === "CET-6" ? CET6 : CET4;
  }

  function getCurrentWords() {
    return getWordsForLevel(state.currentLevel);
  }

  // 获取今日需要学习的单词（新词 + 待复习）
  function getTodayReviewWords() {
    const words = getCurrentWords();
    const now = Date.now();
    const reviewList = [];
    const newList = [];

    words.forEach((w) => {
      const p = getWordProgress(w.w);
      if (p.mastery === "new" && p.reviewCount === 0) {
        newList.push(w);
      } else if (p.nextReview && p.nextReview <= now) {
        reviewList.push(w);
      }
    });

    // 新词取今日目标数量
    const todayNewCount = getTodayLearnedNewCount();
    const remainingNew = Math.max(0, DAILY_GOAL - todayNewCount);
    const newToLearn = newList.slice(0, remainingNew);

    return {
      review: reviewList,
      newWords: newToLearn,
      total: reviewList.length + newToLearn.length,
    };
  }

  // 获取今日已学新词数
  function getTodayLearnedNewCount() {
    const today = new Date().toDateString();
    let count = 0;
    Object.values(state.progress).forEach((p) => {
      if (p.level === state.currentLevel && p.firstLearn) {
        const d = new Date(p.firstLearn);
        if (d.toDateString() === today) count++;
      }
    });
    return count;
  }

  // 获取统计数据
  function getStats() {
    const words = getCurrentWords();
    let total = words.length;
    let newCount = 0;
    let learningCount = 0;
    let masteredCount = 0;
    let todayReviewed = 0;
    const today = new Date().toDateString();

    words.forEach((w) => {
      const p = getWordProgress(w.w);
      if (p.mastery === "new") newCount++;
      else if (p.mastery === "learning") learningCount++;
      else if (p.mastery === "mastered") masteredCount++;

      if (p.lastReview) {
        const d = new Date(p.lastReview);
        if (d.toDateString() === today) todayReviewed++;
      }
    });

    return { total, newCount, learningCount, masteredCount, todayReviewed };
  }

  // 连续学习天数
  function getStreakDays() {
    // 简化实现：检查最近有多少天有学习记录
    const dates = new Set();
    Object.values(state.progress).forEach((p) => {
      if (p.lastReview) {
        dates.add(new Date(p.lastReview).toDateString());
      }
    });

    let streak = 0;
    let checkDate = new Date();
    while (dates.has(checkDate.toDateString())) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
  }

  // 最近7天学习数据
  function getWeeklyData() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toDateString();
      let count = 0;
      Object.values(state.progress).forEach((p) => {
        if (p.lastReview && new Date(p.lastReview).toDateString() === dayStr) {
          count++;
        }
      });
      const labels = ["日", "一", "二", "三", "四", "五", "六"];
      days.push({
        label: labels[d.getDay()],
        count: count,
      });
    }
    return days;
  }

  // ---- 艾宾浩斯复习算法 ----
  function applyRating(word, rating) {
    // rating: known | fuzzy | unknown
    const p = getWordProgress(word);
    const now = Date.now();

    if (!p.firstLearn) p.firstLearn = now;
    p.lastReview = now;
    p.reviewCount++;

    if (rating === "known") p.knownCount++;
    else if (rating === "fuzzy") p.fuzzyCount++;
    else p.unknownCount++;

    // 根据评分调整复习阶段
    if (rating === "known") {
      p.stage = Math.min(p.stage + 1, REVIEW_INTERVALS.length);
      if (p.stage >= 5) p.mastery = "mastered";
      else p.mastery = "learning";
    } else if (rating === "fuzzy") {
      // 模糊：不升级阶段，按当前间隔重新安排
      p.stage = Math.max(p.stage, 1);
      p.mastery = "learning";
    } else {
      // 不认识：降级到第一阶段
      p.stage = Math.max(1, p.stage - 1);
      p.mastery = "learning";
    }

    // 计算下次复习时间
    const intervalIdx = Math.min(p.stage - 1, REVIEW_INTERVALS.length - 1);
    const interval = p.stage > 0 ? REVIEW_INTERVALS[intervalIdx] : 5;
    p.nextReview = now + interval * 60 * 1000;

    saveProgress();
  }

  // ---- 视图渲染 ----
  function render() {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const page = document.getElementById(`page-${state.currentPage}`);
    if (page) {
      page.classList.add("active");
      page.scrollTop = 0;
    }

    // 更新底部导航
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    const navMap = {
      dashboard: "nav-dashboard",
      wordbook: "nav-wordbook",
      stats: "nav-stats",
    };
    const navId = navMap[state.currentPage];
    if (navId) document.getElementById(navId)?.classList.add("active");

    // 更新级别切换
    document.querySelectorAll(".level-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.level === state.currentLevel);
    });

    // 渲染对应页面
    switch (state.currentPage) {
      case "dashboard": renderDashboard(); break;
      case "learn": renderLearn(); break;
      case "quiz": renderQuiz(); break;
      case "spell": renderSpell(); break;
      case "wordbook": renderWordbook(); break;
      case "stats": renderStats(); break;
    }
  }

  // ---- 首页 ----
  function renderDashboard() {
    const stats = getStats();
    const streak = getStreakDays();
    const todayData = getTodayReviewWords();
    const todayNew = getTodayLearnedNewCount();
    const progressPct = total => {
      const learned = stats.learningCount + stats.masteredCount;
      return total > 0 ? Math.round((learned / total) * 100) : 0;
    };

    const pct = progressPct(stats.total);
    const circumference = 2 * Math.PI * 60;
    const dashOffset = circumference * (1 - pct / 100);

    const html = `
      <div class="dashboard">
        <div class="greeting">你好，佳吟同学</div>
        <div class="greeting-sub">今天是 ${formatDate()}，一起背单词吧</div>

        <div class="today-progress">
          <div class="progress-ring-container">
            <svg class="progress-ring" width="140" height="140">
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#6c8aff" />
                  <stop offset="100%" stop-color="#4f6ef7" />
                </linearGradient>
              </defs>
              <circle class="progress-ring-bg" cx="70" cy="70" r="60" />
              <circle class="progress-ring-fill" cx="70" cy="70" r="60"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${dashOffset}" />
            </svg>
            <div class="progress-ring-text">
              <div class="num">${pct}%</div>
              <div class="label">已掌握进度</div>
            </div>
          </div>
          <div style="font-size:14px;color:var(--text-secondary)">
            ${stats.masteredCount + stats.learningCount} / ${stats.total} 词已学习
          </div>
        </div>

        <div class="streak-banner">
          <div class="streak-icon">🔥</div>
          <div class="streak-info">
            <div class="streak-num">${streak} 天</div>
            <div class="streak-label">连续学习${streak > 0 ? '' : '，开始你的第一天吧'}</div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon" style="background:var(--primary-soft)">📖</div>
            <div class="stat-value">${stats.learningCount + stats.masteredCount}</div>
            <div class="stat-label">已学单词</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background:var(--success-soft)">✅</div>
            <div class="stat-value">${stats.masteredCount}</div>
            <div class="stat-label">已掌握</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background:var(--warning-soft)">🕐</div>
            <div class="stat-value">${todayData.review.length}</div>
            <div class="stat-label">待复习</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background:var(--accent-soft)">🆕</div>
            <div class="stat-value">${todayNew}/${DAILY_GOAL}</div>
            <div class="stat-label">今日新词</div>
          </div>
        </div>

        <div class="section-header">开始学习</div>
        <div class="mode-card" onclick="app.startLearn()">
          <div class="mode-icon" style="background:var(--primary-soft)">📇</div>
          <div class="mode-info">
            <div class="mode-title">单词卡片</div>
            <div class="mode-desc">${todayData.total > 0 ? todayData.total + '个单词待学习' : '今日任务已完成'}</div>
          </div>
          <div class="mode-arrow">›</div>
        </div>
        <div class="mode-card" onclick="app.startQuiz()">
          <div class="mode-icon" style="background:var(--success-soft)">✏️</div>
          <div class="mode-info">
            <div class="mode-title">选择题测试</div>
            <div class="mode-desc">看英文选中文，检验学习成果</div>
          </div>
          <div class="mode-arrow">›</div>
        </div>
        <div class="mode-card" onclick="app.startSpell()">
          <div class="mode-icon" style="background:var(--warning-soft)">⌨️</div>
          <div class="mode-info">
            <div class="mode-title">拼写练习</div>
            <div class="mode-desc">看中文拼英文，加深记忆</div>
          </div>
          <div class="mode-arrow">›</div>
        </div>

        <div class="signature">大雨律诗 出品</div>
      </div>
    `;
    document.getElementById("page-dashboard").innerHTML = html;
  }

  // ---- 单词卡片学习 ----
  function startLearn() {
    const todayData = getTodayReviewWords();
    const queue = [...todayData.review, ...todayData.newWords];

    if (queue.length === 0) {
      showToast("今日单词已全部学完，太棒了！");
      return;
    }

    session.mode = "learn";
    session.queue = queue;
    session.index = 0;
    session.flipped = false;
    session.learnStats = { known: 0, fuzzy: 0, unknown: 0 };
    state.currentPage = "learn";
    render();
  }

  function renderLearn() {
    const page = document.getElementById("page-learn");

    if (session.index >= session.queue.length) {
      // 学习完成
      const total = session.queue.length;
      const stats = session.learnStats;
      page.innerHTML = `
        <div class="learn-complete">
          <div class="complete-icon">🎉</div>
          <div class="complete-title">学习完成！</div>
          <div class="complete-sub">你完成了 ${total} 个单词的学习</div>
          <div class="complete-stats">
            <div class="complete-stat">
              <div class="num" style="color:var(--success)">${stats.known}</div>
              <div class="label">认识</div>
            </div>
            <div class="complete-stat">
              <div class="num" style="color:var(--warning)">${stats.fuzzy}</div>
              <div class="label">模糊</div>
            </div>
            <div class="complete-stat">
              <div class="num" style="color:var(--accent)">${stats.unknown}</div>
              <div class="label">不认识</div>
            </div>
          </div>
          <button class="btn-primary" onclick="app.backToDashboard()" style="max-width:200px">返回首页</button>
        </div>
      `;
      return;
    }

    const word = session.queue[session.index];
    const progress = ((session.index) / session.queue.length) * 100;

    page.innerHTML = `
      <div class="learn-view">
        <div class="learn-header">
          <button class="back-btn" onclick="app.backToDashboard()">‹ 返回</button>
          <div class="learn-progress-bar"><div class="fill" style="width:${progress}%"></div></div>
          <div class="learn-count">${session.index + 1}/${session.queue.length}</div>
        </div>

        <div class="flashcard-wrapper">
          <div class="flashcard ${session.flipped ? 'flipped' : ''}" onclick="app.flipCard()">
            <div class="flashcard-face flashcard-front">
              <div class="word-level-tag">${word.level}</div>
              <div class="word">${word.w}</div>
              <div class="phonetic">${word.p}</div>
              <div class="pos">${word.pos}</div>
              <button class="speak-btn" onclick="event.stopPropagation();app.speak('${escapeQuote(word.w)}')" title="点击发音">🔊</button>
              <div class="tap-hint">点击查看释义</div>
            </div>
            <div class="flashcard-face flashcard-back">
              <div class="word-level-tag">${word.level}</div>
              <div class="word">${word.w}</div>
              <div class="phonetic">${word.p}</div>
              <div class="pos">${word.pos}</div>
              <div class="meaning">${word.m}</div>
              <button class="speak-btn speak-btn-light" onclick="event.stopPropagation();app.speak('${escapeQuote(word.w)}')" title="点击发音">🔊</button>
              ${word.ex ? `<div class="example">${word.ex}</div><div class="example-trans">${word.et}</div>` : ''}
              <div class="tap-hint">选择掌握程度</div>
            </div>
          </div>
        </div>

        <div class="rate-buttons" style="${session.flipped ? '' : 'visibility:hidden'}">
          <button class="rate-btn unknown" onclick="app.rateWord('unknown')">
            <span class="rate-icon">😵</span>
            <span class="rate-label">不认识</span>
          </button>
          <button class="rate-btn fuzzy" onclick="app.rateWord('fuzzy')">
            <span class="rate-icon">🤔</span>
            <span class="rate-label">模糊</span>
          </button>
          <button class="rate-btn known" onclick="app.rateWord('known')">
            <span class="rate-icon">😎</span>
            <span class="rate-label">认识</span>
          </button>
        </div>
      </div>
    `;
  }

  function flipCard() {
    session.flipped = !session.flipped;
    renderLearn();
  }

  function rateWord(rating) {
    const word = session.queue[session.index];
    applyRating(word.w, rating);
    session.learnStats[rating]++;
    session.index++;
    session.flipped = false;
    renderLearn();
  }

  // ---- 选择题测试 ----
  function startQuiz() {
    const words = getCurrentWords();
    // 从已学单词中随机选10个，如果不够则从全部中选
    const learnedWords = words.filter(w => {
      const p = getWordProgress(w.w);
      return p.reviewCount > 0;
    });

    let pool = learnedWords.length >= 10 ? learnedWords : words;
    const shuffled = shuffle([...pool]);
    session.queue = shuffled.slice(0, Math.min(10, shuffled.length));
    session.index = 0;
    session.quizAnswered = false;
    session.quizCorrect = 0;
    session.quizWrong = 0;
    session.mode = "quiz";
    state.currentPage = "quiz";
    render();
  }

  function renderQuiz() {
    const page = document.getElementById("page-quiz");

    if (session.index >= session.queue.length) {
      const total = session.queue.length;
      const correct = session.quizCorrect;
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
      let emoji = "🎉", msg = "完美！";
      if (pct < 60) { emoji = "💪"; msg = "继续加油！"; }
      else if (pct < 80) { emoji = "👍"; msg = "不错哦！"; }
      else if (pct < 100) { emoji = "🌟"; msg = "很棒！"; }

      page.innerHTML = `
        <div class="learn-complete">
          <div class="complete-icon">${emoji}</div>
          <div class="complete-title">${msg}</div>
          <div class="complete-sub">答对 ${correct}/${total} 题</div>
          <div class="complete-stats">
            <div class="complete-stat">
              <div class="num" style="color:var(--success)">${pct}%</div>
              <div class="label">正确率</div>
            </div>
            <div class="complete-stat">
              <div class="num" style="color:var(--accent)">${session.quizWrong}</div>
              <div class="label">错题数</div>
            </div>
          </div>
          <div style="display:flex;gap:12px;width:100%;max-width:300px">
            <button class="btn-secondary" onclick="app.backToDashboard()">返回</button>
            <button class="btn-primary" onclick="app.startQuiz()" style="flex:1">再测一次</button>
          </div>
        </div>
      `;
      return;
    }

    const word = session.queue[session.index];
    const allWords = getCurrentWords();
    // 生成4个选项（1个正确 + 3个干扰）
    const distractors = shuffle(allWords.filter(w => w.w !== word.w)).slice(0, 3);
    const options = shuffle([word, ...distractors]);

    const progress = (session.index / session.queue.length) * 100;

    page.innerHTML = `
      <div class="quiz-view">
        <div class="learn-header">
          <button class="back-btn" onclick="app.backToDashboard()">‹ 返回</button>
          <div class="learn-progress-bar"><div class="fill" style="width:${progress}%"></div></div>
          <div class="learn-count">${session.index + 1}/${session.queue.length}</div>
        </div>

        <div class="quiz-question">
          <div class="quiz-type">选择正确的中文释义</div>
          <div class="quiz-word">${word.w}</div>
          <div class="quiz-phonetic">${word.p}</div>
          <button class="speak-btn" onclick="app.speak('${escapeQuote(word.w)}')" title="点击发音">🔊 发音</button>
        </div>

        <div class="quiz-options">
          ${options.map((opt, i) => `
            <div class="quiz-option ${session.quizAnswered ? 'disabled' : ''}"
                 data-answer="${opt.m === word.m ? 'correct' : 'wrong'}"
                 onclick="app.answerQuiz(this, '${escapeQuote(opt.m)}', '${escapeQuote(word.m)}')">
              <div class="option-letter">${String.fromCharCode(65 + i)}</div>
              <div>${opt.m}</div>
            </div>
          `).join('')}
        </div>

        ${session.quizAnswered ? `
          <div style="margin-top:20px;text-align:center">
            <button class="btn-primary" onclick="app.nextQuiz()" style="max-width:200px;margin:0 auto">
              ${session.index + 1 >= session.queue.length ? '查看结果' : '下一题'} ›
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  function answerQuiz(el, selected, correct) {
    if (session.quizAnswered) return;
    session.quizAnswered = true;

    const isCorrect = selected === correct;
    if (isCorrect) {
      el.classList.add("correct");
      session.quizCorrect++;
    } else {
      el.classList.add("wrong");
      session.quizWrong++;
      // 标记正确答案
      document.querySelectorAll(".quiz-option").forEach((opt) => {
        if (opt.dataset.answer === "correct") {
          opt.classList.add("correct");
        }
      });
    }

    // 记录到学习进度
    applyRating(session.queue[session.index].w, isCorrect ? "known" : "unknown");
    renderQuiz();
  }

  function nextQuiz() {
    session.index++;
    session.quizAnswered = false;
    renderQuiz();
  }

  // ---- 拼写练习 ----
  function startSpell() {
    const words = getCurrentWords();
    const learnedWords = words.filter(w => {
      const p = getWordProgress(w.w);
      return p.reviewCount > 0;
    });

    let pool = learnedWords.length >= 10 ? learnedWords : words;
    const shuffled = shuffle([...pool]);
    session.queue = shuffled.slice(0, Math.min(10, shuffled.length));
    session.index = 0;
    session.spellRevealed = false;
    session.mode = "spell";
    state.currentPage = "spell";
    render();
  }

  function renderSpell() {
    const page = document.getElementById("page-spell");

    if (session.index >= session.queue.length) {
      page.innerHTML = `
        <div class="learn-complete">
          <div class="complete-icon">✍️</div>
          <div class="complete-title">拼写练习完成！</div>
          <div class="complete-sub">继续加油，熟能生巧</div>
          <button class="btn-primary" onclick="app.backToDashboard()" style="max-width:200px">返回首页</button>
        </div>
      `;
      return;
    }

    const word = session.queue[session.index];
    const progress = (session.index / session.queue.length) * 100;

    page.innerHTML = `
      <div class="spell-view">
        <div class="learn-header">
          <button class="back-btn" onclick="app.backToDashboard()">‹ 返回</button>
          <div class="learn-progress-bar"><div class="fill" style="width:${progress}%"></div></div>
          <div class="learn-count">${session.index + 1}/${session.queue.length}</div>
        </div>

        <div class="spell-card">
          <div class="spell-pos">${word.pos} · ${word.level}</div>
          <div class="spell-meaning">${word.m}</div>
          <div class="spell-phonetic">${session.spellRevealed ? word.p : '拼写正确后显示音标'}</div>

          <div class="spell-input-wrapper">
            <input type="text" class="spell-input" id="spell-input"
              placeholder="输入单词..."
              autocomplete="off" autocorrect="off" autocapitalize="off"
              spellcheck="false"
              ${session.spellRevealed ? 'disabled' : ''}
              oninput="app.onSpellInput(this)"
              onkeydown="app.onSpellKey(event)" />
          </div>

          <div class="spell-feedback" id="spell-feedback"></div>

          ${session.spellRevealed ? `
            <div class="spell-example">
              <strong>${word.w}</strong>
              <button class="speak-btn speak-btn-inline" onclick="app.speak('${escapeQuote(word.w)}')" title="点击发音">🔊</button>
              ${word.m ? `— ${word.m}` : ''}<br/>
              ${word.ex ? `<span style="color:var(--text-tertiary)">${word.ex}<br/>${word.et}</span>` : ''}
            </div>
          ` : ''}
        </div>

        <div class="spell-actions">
          ${session.spellRevealed ? `
            <button class="spell-btn spell-btn-secondary" onclick="app.backToDashboard()">返回</button>
            <button class="spell-btn spell-btn-primary" onclick="app.nextSpell()">下一个 ›</button>
          ` : `
            <button class="spell-btn spell-btn-secondary" onclick="app.revealSpell()">看答案</button>
            <button class="spell-btn spell-btn-primary" onclick="app.checkSpell()">确认</button>
          `}
        </div>
      </div>
    `;

    if (!session.spellRevealed) {
      setTimeout(() => document.getElementById("spell-input")?.focus(), 100);
    }
  }

  function onSpellInput(el) {
    el.classList.remove("correct", "wrong");
    document.getElementById("spell-feedback").textContent = "";
    document.getElementById("spell-feedback").className = "spell-feedback";
  }

  function onSpellKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      checkSpell();
    }
  }

  function checkSpell() {
    const input = document.getElementById("spell-input");
    if (!input) return;
    const val = input.value.trim().toLowerCase();
    const word = session.queue[session.index];

    if (!val) {
      showToast("请输入单词");
      return;
    }

    const feedback = document.getElementById("spell-feedback");

    if (val === word.w.toLowerCase()) {
      input.classList.add("correct");
      feedback.textContent = "✅ 正确！";
      feedback.className = "spell-feedback correct";
      applyRating(word.w, "known");
    } else {
      input.classList.add("wrong");
      feedback.textContent = `❌ 正确答案：${word.w}`;
      feedback.className = "spell-feedback wrong";
      applyRating(word.w, "unknown");
    }

    session.spellRevealed = true;
    setTimeout(() => renderSpell(), 800);
  }

  function revealSpell() {
    const word = session.queue[session.index];
    const input = document.getElementById("spell-input");
    if (input) {
      input.value = word.w;
      input.classList.add("wrong");
    }
    const feedback = document.getElementById("spell-feedback");
    feedback.textContent = `答案：${word.w}`;
    feedback.className = "spell-feedback wrong";
    applyRating(word.w, "unknown");
    session.spellRevealed = true;
    setTimeout(() => renderSpell(), 600);
  }

  function nextSpell() {
    session.index++;
    session.spellRevealed = false;
    renderSpell();
  }

  // ---- 单词本 ----
  function renderWordbook() {
    const page = document.getElementById("page-wordbook");
    const words = getCurrentWords();

    const html = `
      <div class="wordbook-view">
        <div class="section-header">${state.currentLevel} 词汇本</div>
        <div class="wordbook-search">
          <span class="search-icon">🔍</span>
          <input type="text" id="word-search" placeholder="搜索单词或释义..."
            oninput="app.filterWords(this.value)" />
        </div>
        <div class="wordbook-filter">
          <div class="filter-chip active" data-filter="all" onclick="app.setFilter('all')">全部 ${words.length}</div>
          <div class="filter-chip" data-filter="new" onclick="app.setFilter('new')">未学</div>
          <div class="filter-chip" data-filter="learning" onclick="app.setFilter('learning')">学习中</div>
          <div class="filter-chip" data-filter="mastered" onclick="app.setFilter('mastered')">已掌握</div>
        </div>
        <div class="word-list" id="word-list">
          ${renderWordItems(words)}
        </div>
      </div>
    `;
    page.innerHTML = html;
  }

  function renderWordItems(words, filter = "all", search = "") {
    let filtered = words;

    if (filter !== "all") {
      filtered = filtered.filter(w => {
        const p = getWordProgress(w.w);
        return p.mastery === filter;
      });
    }

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(w =>
        w.w.toLowerCase().includes(s) || w.m.includes(search)
      );
    }

    if (filtered.length === 0) {
      return `<div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-text">没有找到匹配的单词</div>
      </div>`;
    }

    return filtered.map(w => {
      const p = getWordProgress(w.w);
      return `
        <div class="word-item" onclick="app.showWordDetail('${escapeQuote(w.w)}')">
          <div class="word-info">
            <div class="word-text">${w.w}</div>
            <div class="word-meaning">${w.pos} ${w.m}</div>
          </div>
          <div class="word-meta">
            <button class="speak-btn speak-btn-small" onclick="event.stopPropagation();app.speak('${escapeQuote(w.w)}')" title="点击发音">🔊</button>
            <span class="word-level">${w.level}</span>
            <div class="mastery-dot ${p.mastery}" title="${p.mastery}"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  function filterWords(val) {
    const activeFilter = document.querySelector(".filter-chip.active")?.dataset.filter || "all";
    const list = document.getElementById("word-list");
    if (list) {
      list.innerHTML = renderWordItems(getCurrentWords(), activeFilter, val);
    }
  }

  function setFilter(filter) {
    document.querySelectorAll(".filter-chip").forEach(c => {
      c.classList.toggle("active", c.dataset.filter === filter);
    });
    const search = document.getElementById("word-search")?.value || "";
    const list = document.getElementById("word-list");
    if (list) {
      list.innerHTML = renderWordItems(getCurrentWords(), filter, search);
    }
  }

  function showWordDetail(wordStr) {
    const words = getCurrentWords();
    const word = words.find(w => w.w === wordStr);
    if (!word) return;
    const p = getWordProgress(word.w);

    // 使用 flashcard 风格的详情弹窗（简化为页面内展示）
    showToast(`${word.w} — ${word.m}`);

    // 也可以跳转到卡片学习
    session.queue = [word];
    session.index = 0;
    session.flipped = true;
    session.mode = "learn";
    state.currentPage = "learn";
    render();
  }

  // ---- 统计页面 ----
  function renderStats() {
    const page = document.getElementById("page-stats");
    const stats = getStats();
    const streak = getStreakDays();
    const weekly = getWeeklyData();
    const maxWeekly = Math.max(...weekly.map(d => d.count), 1);

    const total = stats.total;
    const learned = stats.learningCount + stats.masteredCount;
    const masteryPct = total > 0 ? Math.round((stats.masteredCount / total) * 100) : 0;
    const learningPct = total > 0 ? Math.round((stats.learningCount / total) * 100) : 0;
    const newPct = total > 0 ? 100 - masteryPct - learningPct : 100;

    // 全局统计（所有级别）
    let allTotal = 0, allMastered = 0, allReviewed = 0;
    Object.values(state.progress).forEach(p => {
      allTotal++;
      if (p.mastery === "mastered") allMastered++;
      allReviewed += p.reviewCount;
    });

    const html = `
      <div class="stats-view">
        <div class="section-header">学习统计</div>

        <div class="stats-section">
          <div class="section-title">📈 总览</div>
          <div class="stats-row">
            <span class="row-label">当前词库</span>
            <span class="row-value">${state.currentLevel}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">词库总量</span>
            <span class="row-value">${stats.total}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">已学单词</span>
            <span class="row-value">${learned}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">已掌握</span>
            <span class="row-value" style="color:var(--success)">${stats.masteredCount}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">今日复习</span>
            <span class="row-value">${stats.todayReviewed}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">连续学习</span>
            <span class="row-value" style="color:var(--warning)">${streak} 天 🔥</span>
          </div>
        </div>

        <div class="stats-section">
          <div class="section-title">📊 近7天学习量</div>
          <div class="bar-chart">
            ${weekly.map(d => `
              <div class="bar-item">
                <div class="bar" style="height:${Math.max(4, (d.count / maxWeekly) * 100)}px">
                  ${d.count > 0 ? `<span class="bar-value">${d.count}</span>` : ''}
                </div>
                <div class="bar-label">${d.label}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="stats-section">
          <div class="section-title">🎯 掌握度分布</div>
          <div class="mastery-distribution">
            <div class="mastery-segment" style="background:var(--success);width:${masteryPct}%">
              ${masteryPct > 8 ? masteryPct + '%' : ''}
            </div>
            <div class="mastery-segment" style="background:var(--warning);width:${learningPct}%">
              ${learningPct > 8 ? learningPct + '%' : ''}
            </div>
            <div class="mastery-segment" style="background:var(--text-tertiary);width:${newPct}%">
              ${newPct > 8 ? newPct + '%' : ''}
            </div>
          </div>
          <div class="mastery-legend">
            <div class="mastery-legend-item">
              <div class="dot" style="background:var(--success)"></div>
              已掌握 ${stats.masteredCount}
            </div>
            <div class="mastery-legend-item">
              <div class="dot" style="background:var(--warning)"></div>
              学习中 ${stats.learningCount}
            </div>
            <div class="mastery-legend-item">
              <div class="dot" style="background:var(--text-tertiary)"></div>
              未学 ${stats.newCount}
            </div>
          </div>
        </div>

        <div class="stats-section">
          <div class="section-title">🏆 全局成就</div>
          <div class="stats-row">
            <span class="row-label">累计学习单词</span>
            <span class="row-value">${allTotal}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">累计掌握单词</span>
            <span class="row-value" style="color:var(--success)">${allMastered}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">累计复习次数</span>
            <span class="row-value">${allReviewed}</span>
          </div>
        </div>

        <div class="stats-section">
          <div class="section-title">☁️ 云端同步</div>
          <div class="stats-row">
            <span class="row-label">同步状态</span>
            <span class="row-value" id="syncStatusText">${getSyncStatusText()}</span>
          </div>
          <div class="stats-row">
            <span class="row-label">最后同步</span>
            <span class="row-value" id="lastSyncText">${cetSync ? cetSync.getLastSyncText() : "未启用"}</span>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            ${cetSync && cetSync.hasToken() ? `
              <button class="btn-secondary" onclick="app.syncNow()">立即同步</button>
              <button class="btn-secondary" onclick="app.openParentPanel()">查看家长面板</button>
              <button class="btn-secondary" onclick="app.clearSyncToken()">解除绑定</button>
            ` : `
              <button class="btn-secondary" onclick="app.showSyncSetup()">设置同步 Token</button>
            `}
          </div>
          ${cetSync && cetSync.hasToken() ? `
            <div style="margin-top:8px;padding:8px 12px;background:var(--success-soft);border-radius:var(--radius-sm);font-size:12px;color:var(--success)">
              ✅ 已绑定，学习数据将自动同步到云端
            </div>
          ` : `
            <div style="margin-top:8px;padding:8px 12px;background:var(--warning-soft);border-radius:var(--radius-sm);font-size:12px;color:var(--warning)">
              ⚠️ 未绑定 Token，数据仅保存在本地。设置后可在家长面板远程查看学习进度
            </div>
          `}
        </div>

        <div style="margin-top:16px">
          <button class="btn-secondary" onclick="app.resetProgress()">重置学习进度</button>
        </div>
      </div>
    `;
    page.innerHTML = html;
  }

  function resetProgress() {
    if (confirm("确定要重置所有学习进度吗？此操作不可恢复！")) {
      state.progress = {};
      saveProgress();
      showToast("学习进度已重置");
      render();
    }
  }

  // ---- 导航 ----
  function navigate(page) {
    state.currentPage = page;
    render();
  }

  function backToDashboard() {
    state.currentPage = "dashboard";
    render();
  }

  function switchLevel(level) {
    state.currentLevel = level;
    render();
  }

  // ---- 工具函数 ----
  function formatDate() {
    const d = new Date();
    const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    return `${months[d.getMonth()]}${d.getDate()}日 星期${days[d.getDay()]}`;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeQuote(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  // ---- 云端同步功能 ----
  function getSyncStatusText() {
    if (!window.cetSync) return "未启用";
    return cetSync.hasToken() ? "已绑定 ✅" : "未绑定";
  }

  function showSyncSetup() {
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px";
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;max-width:340px;width:100%;box-shadow:0 16px 48px rgba(0,0,0,0.2)">
        <div style="font-size:18px;font-weight:700;margin-bottom:12px">☁️ 设置云端同步</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;line-height:1.6">
          输入 GitHub Personal Access Token 开启云端同步。<br>
          同步后可在家长面板远程查看学习进度。
        </div>
        <input type="password" id="syncTokenInput" placeholder="ghp_xxxxxxxx..." 
          style="width:100%;padding:12px;border:2px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;outline:none" 
          onfocus="this.style.borderColor='var(--primary)'" 
          onblur="this.style.borderColor='var(--border)'" />
        <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:16px">
          Token 仅存储在本设备，不会上传到代码中。<br>
          需要 repo 权限的 Fine-grained Token 或 classic Token。
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="this.closest('div[style*=fixed]').remove()" 
            style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--bg);color:var(--text-secondary);font-size:14px;cursor:pointer">取消</button>
          <button id="saveTokenBtn" 
            style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-size:14px;cursor:pointer">绑定</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector("#syncTokenInput");
    const btn = modal.querySelector("#saveTokenBtn");

    input.focus();

    async function saveToken() {
      const token = input.value.trim();
      if (!token) {
        showToast("请输入 Token");
        return;
      }
      cetSync.setToken(token);
      // 测试同步
      showToast("正在测试同步...");
      const result = await cetSync.syncNow(() => state.progress);
      if (result.success) {
        showToast("绑定成功，数据已同步 ✅");
        modal.remove();
        navigate("stats");
      } else {
        showToast("同步失败: " + result.error);
        cetSync.setToken(""); // 清除无效 token
      }
    }

    btn.onclick = saveToken;
    input.onkeydown = (e) => {
      if (e.key === "Enter") saveToken();
    };
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  }

  async function syncNow() {
    if (!cetSync || !cetSync.hasToken()) {
      showToast("请先设置同步 Token");
      return;
    }
    showToast("正在同步...");
    const result = await cetSync.syncNow(() => state.progress);
    if (result.success) {
      showToast("同步成功 ✅");
      navigate("stats");
    } else {
      showToast("同步失败: " + result.error);
    }
  }

  function clearSyncToken() {
    if (confirm("确定要解除云端同步绑定吗？\n本地数据不会丢失，但不再自动同步。")) {
      cetSync.setToken("");
      showToast("已解除绑定");
      navigate("stats");
    }
  }

  function openParentPanel() {
    window.open("parent.html", "_blank");
  }

  // ---- 单词发音 (Web Speech API) ----
  function speak(text) {
    if (!("speechSynthesis" in window)) {
      showToast("当前浏览器不支持语音播放");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.85;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  }

  // ---- 暴露 API ----
  window.app = {
    init() {
      loadProgress();
      // 启动云端自动同步
      if (window.cetSync) {
        cetSync.setupAutoSync(() => state.progress);
      }
      render();
    },
    navigate,
    switchLevel,
    startLearn,
    flipCard,
    rateWord,
    startQuiz,
    answerQuiz,
    nextQuiz,
    startSpell,
    onSpellInput,
    onSpellKey,
    checkSpell,
    revealSpell,
    nextSpell,
    backToDashboard,
    filterWords,
    setFilter,
    showWordDetail,
    resetProgress,
    speak,
    showSyncSetup,
    syncNow,
    clearSyncToken,
    openParentPanel,
  };

  // 初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.app.init());
  } else {
    window.app.init();
  }
})();
