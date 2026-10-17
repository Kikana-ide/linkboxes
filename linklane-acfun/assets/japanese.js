(() => {
  'use strict';

  const ACTIVE_KEY = 'linklane.jlpt.active.v1';
  const HISTORY_KEY = 'linklane.jlpt.history.v1';
  const VERSION = 1;
  const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const LEVEL_DESCRIPTIONS = {
    N5: '入门・日常基础',
    N4: '初级・生活表达',
    N3: '中级・理解与连接',
    N2: '进阶・观点与论述',
    N1: '高阶・语境与推断'
  };
  const SECTIONS = ['词汇', '语法', '阅读'];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const $ = (id) => document.getElementById(id);
  const elements = Object.fromEntries([
    'level-list', 'paper-description', 'paper-meta', 'start-practice', 'setup-panel',
    'exam-panel', 'exam-level', 'exam-progress', 'exam-timer', 'question-map',
    'question-section', 'question-number', 'question-passage', 'question-prompt',
    'answer-options', 'previous-question', 'next-question', 'submit-paper',
    'exam-feedback', 'finish-dialog', 'finish-copy', 'confirm-submit',
    'continue-exam', 'results-panel', 'result-score', 'result-summary',
    'section-scores', 'review-filter', 'answer-review', 'retry-paper',
    'choose-level', 'practice-history'
  ].map((id) => [id, $(id)]));

  // A broken or incomplete page must not leave a half-working exam behind.
  const required = Object.keys(elements).filter((id) => id !== 'practice-history');
  if (required.some((id) => !elements[id])) return;

  function isPaper(paper) {
    return paper && LEVELS.includes(paper.level)
      && typeof paper.title === 'string'
      && typeof paper.description === 'string'
      && paper.durationMinutes === 30
      && Array.isArray(paper.questions) && paper.questions.length > 0
      && paper.questions.length <= 200
      && new Set(paper.questions.map((question) => question && question.id)).size === paper.questions.length
      && paper.questions.every((question) => question
        && (typeof question.id === 'string' || Number.isSafeInteger(question.id))
        && SECTIONS.includes(question.section)
        && typeof question.prompt === 'string' && question.prompt.length > 0
        && (question.passage === undefined || typeof question.passage === 'string')
        && Array.isArray(question.options) && question.options.length === 4
        && question.options.every((option) => typeof option === 'string' && option.length > 0)
        && Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4
        && typeof question.explanation === 'string');
  }

  const source = Array.isArray(globalThis.JLPT_PAPERS) ? globalThis.JLPT_PAPERS : [];
  const papers = LEVELS.map((level) => source.find((paper) => paper && paper.level === level && isPaper(paper))).filter(Boolean);
  let selectedPaper = papers[0];
  let active = null;
  let completed = null;
  let timer = null;
  let storageWarningShown = false;
  let timeWarningShown = false;
  let history = [];

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function focus(element) {
    if (!element) return;
    if (!element.matches('button, input, select, a[href], [tabindex]')) element.tabIndex = -1;
    // Bring the focused question into view when the navigation is above it on mobile.
    element.focus();
  }

  function feedback(message) {
    elements['exam-feedback'].textContent = message;
  }

  function readStored(key) {
    try {
      const value = globalThis.localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function removeStored(key) {
    try { globalThis.localStorage.removeItem(key); } catch { /* Storage is optional. */ }
  }

  function writeStored(key, value) {
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function signature(paper) {
    // Reject progress from a different revision of the question set.
    const text = JSON.stringify(paper.questions.map((question) => [
      question.id, question.section, question.prompt, question.passage || '', question.options, question.answer
    ]));
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${paper.questions.length}:${hash >>> 0}`;
  }

  function saveActive() {
    if (!active) return;
    if (!writeStored(ACTIVE_KEY, active) && !storageWarningShown) {
      storageWarningShown = true;
      feedback('当前浏览器无法保存进度。可以继续答题，请尽量保持本页面打开。');
    }
  }

  function restoreActive(value) {
    if (!value || value.version !== VERSION) return null;
    const paper = papers.find((item) => item.level === value.level);
    if (!paper || value.paperSignature !== signature(paper)) return null;
    const now = Date.now();
    const duration = paper.durationMinutes * 60 * 1000;
    if (!Array.isArray(value.answers) || value.answers.length !== paper.questions.length
      || !value.answers.every((answer) => answer === null || (Number.isInteger(answer) && answer >= 0 && answer <= 3))
      || !Number.isInteger(value.currentIndex) || value.currentIndex < 0 || value.currentIndex >= paper.questions.length
      || !Number.isSafeInteger(value.startedAt) || !Number.isSafeInteger(value.deadline)
      || value.startedAt <= 0 || value.startedAt > now + 60_000
      || now - value.startedAt > 7 * 24 * 60 * 60 * 1000
      || value.deadline - value.startedAt !== duration) return null;
    return {
      version: VERSION,
      level: paper.level,
      paperSignature: signature(paper),
      answers: value.answers.slice(),
      currentIndex: value.currentIndex,
      startedAt: value.startedAt,
      deadline: value.deadline
    };
  }

  function scoreAnswers(paper, answers) {
    const sections = SECTIONS.map((section) => ({ section, total: 0, answered: 0, correct: 0 }));
    let correct = 0;
    let answered = 0;
    paper.questions.forEach((question, index) => {
      const section = sections.find((item) => item.section === question.section);
      section.total += 1;
      if (answers[index] !== null) {
        answered += 1;
        section.answered += 1;
      }
      if (answers[index] === question.answer) {
        correct += 1;
        section.correct += 1;
      }
    });
    return {
      total: paper.questions.length,
      correct,
      answered,
      unanswered: paper.questions.length - answered,
      score: Math.round(correct / paper.questions.length * 100),
      sections: sections.filter((section) => section.total > 0)
    };
  }

  function loadHistory() {
    const saved = readStored(HISTORY_KEY);
    if (!saved || saved.version !== VERSION || !Array.isArray(saved.records)) return [];
    return saved.records.filter((entry) => entry && LEVELS.includes(entry.level)
      && Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 100
      && Number.isInteger(entry.total) && entry.total > 0 && entry.total <= 200
      && Number.isInteger(entry.answered) && entry.answered > 0 && entry.answered <= entry.total
      && Number.isSafeInteger(entry.finishedAt) && entry.finishedAt > 0 && entry.finishedAt <= Date.now() + 60_000
      && Number.isInteger(entry.durationSeconds) && entry.durationSeconds >= 0 && entry.durationSeconds <= 1800)
      .sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 5);
  }

  function renderHistory() {
    if (!elements['practice-history']) return;
    const container = elements['practice-history'];
    container.replaceChildren();
    if (!history.length) {
      container.append(node('p', 'history-empty', '完成答题后，这里会保留最近 5 次练习记录（仅保存在当前浏览器）。'));
      return;
    }
    history.forEach((entry) => {
      const item = node('div', 'history-item');
      const title = node('strong', '', `${entry.level} · ${entry.score} 分`);
      const detail = node('span', '', `已答 ${entry.answered}/${entry.total} 题`);
      const time = node('time');
      time.dateTime = new Date(entry.finishedAt).toISOString();
      time.textContent = new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai'
      }).format(entry.finishedAt);
      item.append(title, detail, time);
      container.append(item);
    });
  }

  function renderSetup() {
    elements['level-list'].replaceChildren();
    LEVELS.forEach((level) => {
      const paper = papers.find((item) => item.level === level);
      const button = node('button', 'level-choice');
      button.append(
        node('strong', '', level),
        node('span', '', LEVEL_DESCRIPTIONS[level]),
        node('small', '', `${paper ? paper.questions.length : 24} 题 ↗`)
      );
      button.type = 'button';
      button.dataset.level = level;
      button.disabled = !paper;
      const selected = selectedPaper && selectedPaper.level === level;
      button.classList.toggle('is-selected', Boolean(selected));
      button.setAttribute('aria-pressed', String(Boolean(selected)));
      if (!paper) button.setAttribute('aria-label', `${level} 题库暂时不可用`);
      button.addEventListener('click', () => {
        selectedPaper = paper;
        updatePaperDescription();
        elements['level-list'].querySelectorAll('button').forEach((choice) => {
          const isSelected = choice.dataset.level === level;
          choice.classList.toggle('is-selected', isSelected);
          choice.setAttribute('aria-pressed', String(isSelected));
        });
      });
      elements['level-list'].append(button);
    });
    updatePaperDescription();
  }

  function updatePaperDescription() {
    if (!selectedPaper) {
      elements['paper-description'].textContent = '题库暂时未能加载，请刷新页面后重试。';
      elements['paper-meta'].textContent = '';
      elements['start-practice'].disabled = true;
      return;
    }
    elements['paper-description'].textContent = selectedPaper.description;
    const counts = SECTIONS.map((section) => `${section} ${selectedPaper.questions.filter((question) => question.section === section).length} 题`);
    elements['paper-meta'].textContent = `${selectedPaper.questions.length} 题 · ${selectedPaper.durationMinutes} 分钟 · ${counts.join(' / ')}`;
    elements['start-practice'].disabled = false;
    elements['start-practice'].textContent = `开始 ${selectedPaper.level} 模拟练习`;
  }

  function showPanel(name) {
    elements['setup-panel'].hidden = name !== 'setup';
    elements['exam-panel'].hidden = name !== 'exam';
    elements['results-panel'].hidden = name !== 'results';
  }

  function activePaper() {
    return active && papers.find((paper) => paper.level === active.level);
  }

  function answeredCount() {
    return active.answers.filter((answer) => answer !== null).length;
  }

  function renderProgress() {
    const paper = activePaper();
    if (!paper) return;
    const count = answeredCount();
    elements['exam-progress'].textContent = `已答 ${count} / ${paper.questions.length} 题`;
    const map = elements['question-map'];
    map.replaceChildren();
    paper.questions.forEach((question, index) => {
      const button = node('button', 'question-dot', String(index + 1));
      const answered = active.answers[index] !== null;
      button.type = 'button';
      button.classList.toggle('is-current', index === active.currentIndex);
      button.classList.toggle('is-answered', answered);
      button.setAttribute('aria-label', `第 ${index + 1} 题，${question.section}，${answered ? '已作答' : '未作答'}`);
      if (index === active.currentIndex) button.setAttribute('aria-current', 'step');
      button.addEventListener('click', () => goToQuestion(index));
      map.append(button);
    });
  }

  function renderQuestion(moveFocus = true) {
    const paper = activePaper();
    if (!paper) return;
    const question = paper.questions[active.currentIndex];
    elements['exam-level'].textContent = `${paper.level} 模拟练习`;
    elements['question-section'].textContent = question.section;
    elements['question-number'].textContent = `第 ${active.currentIndex + 1} / ${paper.questions.length} 题`;
    elements['question-passage'].textContent = question.passage || '';
    elements['question-passage'].hidden = !question.passage;
    elements['question-passage'].lang = 'ja';
    elements['question-prompt'].textContent = question.prompt;
    elements['question-prompt'].lang = 'ja';
    const options = elements['answer-options'];
    options.replaceChildren();
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-labelledby', 'question-prompt');
    question.options.forEach((option, index) => {
      const label = node('label', 'answer-option');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'answer';
      input.value = String(index);
      input.checked = active.answers[active.currentIndex] === index;
      label.classList.toggle('is-selected', input.checked);
      const text = node('span', '', `${LETTERS[index]}　${option}`);
      text.lang = 'ja';
      label.append(input, text);
      input.addEventListener('change', () => {
        if (!active || !input.checked) return;
        // An expired timer cannot gain an extra answer from a late click.
        if (Date.now() >= active.deadline) {
          finishExam('timeout');
          return;
        }
        active.answers[active.currentIndex] = index;
        options.querySelectorAll('.answer-option').forEach((choice) => {
          choice.classList.toggle('is-selected', choice.querySelector('input').checked);
        });
        saveActive();
        renderProgress();
      });
      options.append(label);
    });
    elements['previous-question'].disabled = active.currentIndex === 0;
    elements['next-question'].disabled = active.currentIndex === paper.questions.length - 1;
    renderProgress();
    if (moveFocus) focus(elements['question-prompt']);
  }

  function goToQuestion(index) {
    if (!active) return;
    if (Date.now() >= active.deadline) {
      finishExam('timeout');
      return;
    }
    const paper = activePaper();
    if (!Number.isInteger(index) || index < 0 || index >= paper.questions.length) return;
    active.currentIndex = index;
    saveActive();
    renderQuestion();
  }

  function updateTimer() {
    if (!active) return;
    const seconds = Math.max(0, Math.ceil((active.deadline - Date.now()) / 1000));
    elements['exam-timer'].textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    elements['exam-timer'].setAttribute('aria-label', `剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`);
    elements['exam-timer'].classList.toggle('is-urgent', seconds <= 300);
    if (!seconds) {
      finishExam('timeout');
    } else if (seconds <= 300 && !timeWarningShown) {
      timeWarningShown = true;
      feedback('剩余时间不足 5 分钟，请检查未作答的题目。时间结束后会自动交卷。');
    }
  }

  function startTimer() {
    if (timer !== null) globalThis.clearInterval(timer);
    updateTimer();
    if (active) timer = globalThis.setInterval(updateTimer, 1000);
  }

  function startExam() {
    if (!selectedPaper || active) return;
    const startedAt = Date.now();
    active = {
      version: VERSION,
      level: selectedPaper.level,
      paperSignature: signature(selectedPaper),
      answers: selectedPaper.questions.map(() => null),
      currentIndex: 0,
      startedAt,
      deadline: startedAt + selectedPaper.durationMinutes * 60 * 1000
    };
    completed = null;
    timeWarningShown = false;
    storageWarningShown = false;
    feedback('已开始计时。点击题号可检查和补答，刷新页面可恢复已保存的进度。');
    showPanel('exam');
    renderQuestion();
    saveActive();
    startTimer();
  }

  function closeDialog() {
    const dialog = elements['finish-dialog'];
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function requestSubmit() {
    if (!active) return;
    if (Date.now() >= active.deadline) {
      finishExam('timeout');
      return;
    }
    const remaining = active.answers.length - answeredCount();
    const message = remaining
      ? `还有 ${remaining} 题未作答。未答题按错误计分，交卷后可查看全部答案解析。${remaining === active.answers.length ? '当前为空卷，不会计入练习记录。' : ''}`
      : '所有题目均已作答。交卷后可查看得分和全部答案解析。';
    elements['finish-copy'].textContent = message;
    const dialog = elements['finish-dialog'];
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
      focus(remaining ? elements['continue-exam'] : elements['confirm-submit']);
    } else if (globalThis.confirm(`${message}\n确认交卷吗？`)) {
      finishExam('manual');
    }
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
  }

  function finishExam(reason) {
    if (!active) return;
    const state = active;
    const paper = activePaper();
    const result = scoreAnswers(paper, state.answers);
    const finishedAt = Date.now();
    completed = {
      paper,
      answers: state.answers.slice(),
      result,
      reason,
      durationSeconds: Math.min(paper.durationMinutes * 60, Math.max(0, Math.floor((finishedAt - state.startedAt) / 1000)))
    };
    active = null;
    if (timer !== null) globalThis.clearInterval(timer);
    timer = null;
    closeDialog();
    removeStored(ACTIVE_KEY);
    // Empty or abandoned sessions are shown honestly and do not count as practice.
    if (result.answered > 0) {
      history.unshift({
        level: paper.level,
        score: result.score,
        total: result.total,
        answered: result.answered,
        finishedAt,
        durationSeconds: completed.durationSeconds
      });
      history = history.slice(0, 5);
      writeStored(HISTORY_KEY, { version: VERSION, records: history });
      renderHistory();
    }
    renderResults();
  }

  function renderResults() {
    const { paper, result, reason, durationSeconds } = completed;
    showPanel('results');
    elements['result-score'].textContent = String(result.score);
    elements['result-score'].setAttribute('aria-label', `原始练习得分 ${result.score} 分，满分 100 分`);
    const prefix = reason === 'timeout' ? '时间已到，已自动交卷。' : '';
    const empty = result.answered === 0 ? '本次未作答，未计入练习记录。' : '';
    const resultsTitle = $('results-title');
    if (resultsTitle) resultsTitle.textContent = result.answered === 0 ? '本次练习未作答。' : '又向前走了一小步。';
    elements['result-summary'].textContent = `${prefix}${empty}${paper.level} · 答对 ${result.correct}/${result.total} 题 · 已答 ${result.answered} 题 · 用时 ${formatDuration(durationSeconds)}。各题等权计算原始得分，不等同于 JLPT 量尺分，也不用于预测合格。`;
    elements['section-scores'].replaceChildren();
    result.sections.forEach((section) => {
      const card = node('div', 'section-score');
      card.append(
        node('span', 'section-score-label', section.section),
        node('strong', '', `${section.correct} / ${section.total}`),
        node('span', '', `已答 ${section.answered} 题 · 正确率 ${Math.round(section.correct / section.total * 100)}%`)
      );
      elements['section-scores'].append(card);
    });
    elements['review-filter'].value = 'all';
    renderReview();
    focus(elements['results-panel']);
  }

  function renderReview() {
    if (!completed) return;
    const wrongOnly = elements['review-filter'].value === 'wrong';
    const container = elements['answer-review'];
    container.replaceChildren();
    completed.paper.questions.forEach((question, index) => {
      const userAnswer = completed.answers[index];
      const correct = userAnswer === question.answer;
      if (wrongOnly && correct) return;
      const item = node('article', `review-item ${correct ? 'review-correct' : 'review-wrong'}`);
      item.append(node('h3', '', `${String(index + 1).padStart(2, '0')} · ${question.section} · ${correct ? '回答正确' : userAnswer === null ? '未作答' : '回答错误'}`));
      if (question.passage) {
        const passage = node('p', 'review-passage', question.passage);
        passage.lang = 'ja';
        item.append(passage);
      }
      const prompt = node('p', 'review-prompt', question.prompt);
      prompt.lang = 'ja';
      item.append(prompt);
      const options = node('ol', 'review-options');
      options.setAttribute('aria-label', '本题选项');
      question.options.forEach((option, optionIndex) => {
        const correctOption = optionIndex === question.answer;
        const chosenOption = optionIndex === userAnswer;
        const suffix = [correctOption ? '正确答案' : '', chosenOption ? '你的选择' : ''].filter(Boolean).join('；');
        const line = node('li', '', `${LETTERS[optionIndex]}　${option}${suffix ? `（${suffix}）` : ''}`);
        line.lang = 'ja';
        line.classList.toggle('is-correct', correctOption);
        line.classList.toggle('is-user-answer', chosenOption);
        options.append(line);
      });
      item.append(options);
      item.append(node('p', 'review-answer', `你的答案：${userAnswer === null ? '未作答' : LETTERS[userAnswer]}　·　正确答案：${LETTERS[question.answer]}`));
      item.append(node('p', 'review-explanation', `解析：${question.explanation}`));
      container.append(item);
    });
    if (!container.children.length) {
      container.append(node('p', 'review-empty', '本次所有题目均回答正确。选择“全部题目”可复习完整解析。'));
    }
  }

  elements['start-practice'].addEventListener('click', startExam);
  elements['previous-question'].addEventListener('click', () => active && goToQuestion(active.currentIndex - 1));
  elements['next-question'].addEventListener('click', () => active && goToQuestion(active.currentIndex + 1));
  elements['submit-paper'].addEventListener('click', requestSubmit);
  elements['confirm-submit'].addEventListener('click', () => finishExam(active && Date.now() >= active.deadline ? 'timeout' : 'manual'));
  elements['continue-exam'].addEventListener('click', () => {
    closeDialog();
    focus(elements['question-prompt']);
  });
  elements['review-filter'].addEventListener('change', renderReview);
  elements['retry-paper'].addEventListener('click', () => {
    if (!completed) return;
    selectedPaper = completed.paper;
    startExam();
  });
  elements['choose-level'].addEventListener('click', () => {
    showPanel('setup');
    renderSetup();
    focus(elements['level-list'].querySelector('[aria-pressed="true"]'));
  });
  globalThis.addEventListener('beforeunload', (event) => {
    if (!active) return;
    saveActive();
    event.preventDefault();
    event.returnValue = '';
  });
  globalThis.addEventListener('pagehide', () => { if (active) saveActive(); });
  globalThis.addEventListener('focus', () => { if (active) updateTimer(); });
  document.addEventListener('visibilitychange', () => {
    if (active) {
      saveActive();
      if (!document.hidden) updateTimer();
    }
  });

  history = loadHistory();
  renderHistory();
  renderSetup();
  const stored = readStored(ACTIVE_KEY);
  active = restoreActive(stored);
  if (active) {
    selectedPaper = activePaper();
    showPanel('exam');
    feedback('已恢复本次练习。计时从原开始时间继续，关闭页面期间也会计时。');
    renderQuestion();
    startTimer();
  } else {
    if (stored) removeStored(ACTIVE_KEY);
    showPanel('setup');
  }
})();
