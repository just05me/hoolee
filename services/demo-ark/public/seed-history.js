// Фейковая история активности — чтобы демо при первом открытии выглядело как уже
// работающая система, а не пустая коробка. Задачи «выполнены N часов назад» (относительное
// время, пересчитывается от текущего момента — не протухнет, когда бы демо ни открыли).
// Один пункт специально оставлен в статусе running/approval — чтобы «Подтверждения»
// и «Активные задачи» тоже не были пустыми сразу при заходе.
//
// Это витрина, а не подмена настоящего пайплайна: как только посетитель запускает
// что-то через чат, дальше всё идёт по-настоящему (см. state.js/pipeline.py/canned.py).

const MODEL = 'deepseek-chat';
const PRICE_IN = 0.27 / 1_000_000;
const PRICE_OUT = 1.10 / 1_000_000;
const cost = (ti, to) => Math.round((ti * PRICE_IN + to * PRICE_OUT) * 1e6) / 1e6;
const ago = (ms) => Date.now() - ms;
const MIN = 60_000, HOUR = 3_600_000;

function roleStep(kind, taskId, extra, ti, to, latency, ts) {
  return { kind, ts, data: { taskId, tokensIn: ti, tokensOut: to, costUsd: cost(ti, to), latencyMs: latency, valid: true, ...extra } };
}

export function seedHistory(store) {
  const now = Date.now();

  // ---------- T1: КП с одним циклом доработки ----------
  const t1 = 'seed_t1';
  const t1Created = ago(3 * HOUR);
  const t1Block = { id: 'b1', department: 'sales', title: 'Коммерческое предложение', description: 'Продление годового контракта — «Барака Трейд»', deps: [], acceptance_criteria: ['Указаны условия отсрочки', 'Указана скидка по объёму', 'Указан срок действия предложения'] };
  const t1Draft = 'Коммерческое предложение для «Барака Трейд»: продление годового контракта на поставку бытовой химии, отсрочка платежа 14 дней, скидка 8% при объёме от 500 уп./мес.';
  const t1Final = 'Коммерческое предложение для «Барака Трейд»: продление годового контракта на поставку бытовой химии на тех же условиях — отсрочка платежа 14 дней, при объёме от 500 уп./мес скидка 8%. Предложение действует до 30.09.2026, ответ ожидаем до 25.09.';
  const t1Steps = [
    { kind: 'task_created', ts: t1Created, data: { taskId: t1, title: 'КП для «Барака Трейд» — продление контракта' } },
    roleStep('task_triaged', t1, { result: { level: 'medium', departments: ['sales'], confidence: 0.91, reason: 'Задача одного отдела — подготовка коммерческого предложения.' } }, 360, 110, 1180, t1Created + 4000),
    roleStep('plan_created', t1, { plan: { blocks: [t1Block] } }, 520, 210, 1650, t1Created + 9000),
    roleStep('work_result', t1, { blockId: 'b1', department: 'sales', result: { status: 'done', artifact: t1Draft, used_sources: ['d-sales-terms'] } }, 600, 230, 2000, t1Created + 16000),
    roleStep('review_verdict', t1, { blockId: 'b1', cycle: 0, result: { verdict: 'rework', issues: [{ severity: 'minor', text: 'Не указан срок действия предложения' }] } }, 300, 90, 1100, t1Created + 21000),
    { kind: 'rework_requested', ts: t1Created + 22000, data: { taskId: t1, blockId: 'b1', issues: [{ severity: 'minor', text: 'Не указан срок действия предложения' }], cycle: 1 } },
    roleStep('work_result', t1, { blockId: 'b1', department: 'sales', result: { status: 'done', artifact: t1Final, used_sources: ['d-sales-terms', 'l-sales-2'] } }, 640, 250, 2100, t1Created + 29000),
    roleStep('review_verdict', t1, { blockId: 'b1', cycle: 1, result: { verdict: 'pass', issues: [] } }, 310, 80, 1000, t1Created + 34000),
    roleStep('acceptance_verdict', t1, { result: { verdict: 'accept', unmet_requirements: [], comment: 'КП готово, все критерии закрыты.' } }, 460, 150, 1400, t1Created + 40000),
    { kind: 'approval_requested', ts: t1Created + 41000, data: { taskId: t1, type: 'send_message', summary: 'КП готово, все критерии закрыты.', artifact: t1Final } },
    { kind: 'approval_decided', ts: t1Created + 95000, data: { taskId: t1, decision: 'approve' } },
    { kind: 'task_done', ts: t1Created + 95000, data: { taskId: t1, summary: 'КП готово, все критерии закрыты.', artifact: t1Final } },
  ];
  const t1Cost = t1Steps.reduce((s, st) => s + (st.data.costUsd || 0), 0);
  store.tasks[t1] = {
    id: t1, title: 'КП для «Барака Трейд» — продление контракта', status: 'done', level: 'medium',
    createdAt: t1Created, steps: t1Steps, totalCostUsd: t1Cost, departments: new Set(['sales']),
    direct: false, summary: 'КП готово, все критерии закрыты.', artifact: t1Final, durationMs: 95000,
  };
  (store.todos.sales = store.todos.sales || []).push({ id: `${t1}-b1`, board: 'sales', title: t1Block.title, status: 'done', blockId: 'b1', taskId: t1, deps: [] });

  // ---------- T2: акция на несколько отделов параллельно ----------
  const t2 = 'seed_t2';
  const t2Created = ago(6 * HOUR);
  const t2Blocks = [
    { id: 'b1', department: 'analytics', title: 'Список остатков для акции', description: 'Выгрузить SKU с низкой оборачиваемостью', deps: [], acceptance_criteria: ['Список SKU с остатками'] },
    { id: 'b2', department: 'sales', title: 'Обновление цен в прайсе', description: 'Проставить акционные цены', deps: ['b1'], acceptance_criteria: ['Цены проставлены', 'Указан срок акции'] },
    { id: 'b3', department: 'marketing', title: 'Рассылка и пост в Instagram', description: 'Текст рассылки и поста', deps: ['b1'], acceptance_criteria: ['Есть текст рассылки', 'Есть текст поста'] },
  ];
  const t2Artifacts = {
    b1: 'Остатки для акции: губки хозяйственные (620 уп.), перчатки резиновые (740 уп.), тряпки для пола (410 уп.) — суммарно на $2900.',
    b2: 'Цены обновлены: губки −15% (до 05.10), перчатки −10%, тряпки для пола −20%. Акция отмечена в прайс-листе.',
    b3: 'Рассылка: «Скидки до 20% на хозтовары — успейте до 5 октября». Пост в Instagram подготовлен, публикация — четверг 10:00.',
  };
  const t2Steps = [
    { kind: 'task_created', ts: t2Created, data: { taskId: t2, title: 'Акция на складские остатки хозтоваров' } },
    roleStep('task_triaged', t2, { result: { level: 'complex', departments: ['analytics', 'sales', 'marketing'], confidence: 0.88, reason: 'Задача затрагивает несколько отделов — нужен согласованный план.' } }, 410, 140, 1400, t2Created + 4000),
    roleStep('plan_created', t2, { plan: { blocks: t2Blocks } }, 640, 270, 1900, t2Created + 10000),
    roleStep('work_result', t2, { blockId: 'b1', department: 'analytics', result: { status: 'done', artifact: t2Artifacts.b1, used_sources: ['d-analytics-report'] } }, 520, 210, 1800, t2Created + 20000),
    roleStep('review_verdict', t2, { blockId: 'b1', cycle: 0, result: { verdict: 'pass', issues: [] } }, 270, 70, 950, t2Created + 25000),
    roleStep('work_result', t2, { blockId: 'b2', department: 'sales', result: { status: 'done', artifact: t2Artifacts.b2, used_sources: ['d-sales-price'] } }, 480, 200, 1700, t2Created + 36000),
    roleStep('work_result', t2, { blockId: 'b3', department: 'marketing', result: { status: 'done', artifact: t2Artifacts.b3, used_sources: ['l-marketing-1'] } }, 510, 220, 1900, t2Created + 38000),
    roleStep('review_verdict', t2, { blockId: 'b2', cycle: 0, result: { verdict: 'pass', issues: [] } }, 260, 70, 900, t2Created + 43000),
    roleStep('review_verdict', t2, { blockId: 'b3', cycle: 0, result: { verdict: 'pass', issues: [] } }, 270, 80, 1000, t2Created + 45000),
    roleStep('acceptance_verdict', t2, { result: { verdict: 'accept', unmet_requirements: [], comment: 'Акция согласована между Аналитикой, Продажами и Маркетингом.' } }, 560, 190, 1600, t2Created + 52000),
    { kind: 'approval_requested', ts: t2Created + 53000, data: { taskId: t2, type: 'send_message', summary: 'Акция согласована между Аналитикой, Продажами и Маркетингом.', artifact: Object.values(t2Artifacts).join('\n\n') } },
    { kind: 'approval_decided', ts: t2Created + 140000, data: { taskId: t2, decision: 'approve' } },
    { kind: 'task_done', ts: t2Created + 140000, data: { taskId: t2, summary: 'Акция согласована между Аналитикой, Продажами и Маркетингом.', artifact: Object.values(t2Artifacts).join('\n\n') } },
  ];
  const t2Cost = t2Steps.reduce((s, st) => s + (st.data.costUsd || 0), 0);
  store.tasks[t2] = {
    id: t2, title: 'Акция на складские остатки хозтоваров', status: 'done', level: 'complex',
    createdAt: t2Created, steps: t2Steps, totalCostUsd: t2Cost, departments: new Set(['analytics', 'sales', 'marketing']),
    direct: false, summary: 'Акция согласована между Аналитикой, Продажами и Маркетингом.', artifact: Object.values(t2Artifacts).join('\n\n'), durationMs: 140000,
  };
  for (const b of t2Blocks) {
    (store.todos[b.department] = store.todos[b.department] || []).push({ id: `${t2}-${b.id}`, board: b.department, title: b.title, status: 'done', blockId: b.id, taskId: t2, deps: b.deps });
  }

  // ---------- T3: жалоба клиента (поддержка, вчера) ----------
  const t3 = 'seed_t3';
  const t3Created = ago(22 * HOUR);
  const t3Block = { id: 'b1', department: 'support', title: 'Разбор недостачи по заказу', description: 'Сверить накладную №987, предложить решение', deps: [], acceptance_criteria: ['Указана причина по накладной', 'Есть решение для клиента'] };
  const t3Artifact = 'По накладной №987 отгружено 210 из 216 упаковок — недостача 6 упаковок подтверждена на складе. Решение: довезти недостающие упаковки в течение 2 рабочих дней. Клиент уведомлён, статус заказа обновлён.';
  const t3Steps = [
    { kind: 'task_created', ts: t3Created, data: { taskId: t3, title: '«Оилавий Дўкон»: недостача по накладной №987' } },
    roleStep('task_triaged', t3, { result: { level: 'medium', departments: ['support'], confidence: 0.93, reason: 'Обращение клиента по конкретному заказу.' } }, 350, 100, 1150, t3Created + 3000),
    roleStep('plan_created', t3, { plan: { blocks: [t3Block] } }, 470, 190, 1500, t3Created + 8000),
    roleStep('work_result', t3, { blockId: 'b1', department: 'support', result: { status: 'done', artifact: t3Artifact, used_sources: ['l-support-1'] } }, 580, 220, 1900, t3Created + 15000),
    roleStep('review_verdict', t3, { blockId: 'b1', cycle: 0, result: { verdict: 'pass', issues: [] } }, 300, 80, 1050, t3Created + 20000),
    roleStep('acceptance_verdict', t3, { result: { verdict: 'accept', unmet_requirements: [], comment: 'Причина установлена, клиенту предложено решение.' } }, 420, 140, 1350, t3Created + 26000),
    { kind: 'approval_requested', ts: t3Created + 27000, data: { taskId: t3, type: 'send_message', summary: 'Причина установлена, клиенту предложено решение.', artifact: t3Artifact } },
    { kind: 'approval_decided', ts: t3Created + 52000, data: { taskId: t3, decision: 'approve' } },
    { kind: 'task_done', ts: t3Created + 52000, data: { taskId: t3, summary: 'Причина установлена, клиенту предложено решение.', artifact: t3Artifact } },
  ];
  const t3Cost = t3Steps.reduce((s, st) => s + (st.data.costUsd || 0), 0);
  store.tasks[t3] = {
    id: t3, title: '«Оилавий Дўкон»: недостача по накладной №987', status: 'done', level: 'medium',
    createdAt: t3Created, steps: t3Steps, totalCostUsd: t3Cost, departments: new Set(['support']),
    direct: false, summary: 'Причина установлена, клиенту предложено решение.', artifact: t3Artifact, durationMs: 52000,
  };
  (store.todos.support = store.todos.support || []).push({ id: `${t3}-b1`, board: 'support', title: t3Block.title, status: 'done', blockId: 'b1', taskId: t3, deps: [] });

  // ---------- T4: простой вопрос напрямую ----------
  const t4 = 'seed_t4';
  const t4Created = ago(20 * MIN);
  const qualifying = store.deals.filter((d) => d.stage === 'qualifying');
  const names = qualifying.map((d) => `«${(store.clients.find((c) => c.id === d.clientId) || {}).name || d.clientId}» — ${d.title} ($${d.amountUsd})`).join('; ');
  const t4Answer = `Сейчас ${qualifying.length} сделки на стадии «Квалификация»: ${names}.`;
  const t4Steps = [
    { kind: 'task_created', ts: t4Created, data: { taskId: t4, title: 'Сколько сделок на стадии «Квалификация»?' } },
    roleStep('task_triaged', t4, { result: { level: 'simple', departments: ['analytics'], confidence: 0.94, reason: 'Прямой вопрос по данным CRM.' } }, 320, 85, 1050, t4Created + 2000),
    roleStep('direct_answer', t4, { result: { answer: t4Answer, sources: qualifying.map((d) => ({ kind: 'db', id: d.id })), found: true } }, 400, 120, 1300, t4Created + 4000),
    { kind: 'task_done', ts: t4Created + 4200, data: { taskId: t4, summary: t4Answer, artifact: t4Answer, direct: true } },
  ];
  const t4Cost = t4Steps.reduce((s, st) => s + (st.data.costUsd || 0), 0);
  store.tasks[t4] = {
    id: t4, title: 'Сколько сделок на стадии «Квалификация»?', status: 'done', level: 'simple',
    createdAt: t4Created, steps: t4Steps, totalCostUsd: t4Cost, departments: new Set(),
    direct: true, summary: t4Answer, artifact: t4Answer, durationMs: 4200,
  };

  // ---------- T5: ждёт подтверждения человека прямо сейчас ----------
  const t5 = 'seed_t5';
  const t5Created = ago(12 * MIN);
  const t5Block = { id: 'b1', department: 'marketing', title: 'Обновление сезонного прайс-листа', description: 'Добавить сезонные SKU, скорректировать цены', deps: [], acceptance_criteria: ['Добавлены новые SKU', 'Скорректированы цены по закупке'] };
  const t5Artifact = 'Прайс-лист на осенний сезон обновлён: добавлены 4 новых SKU (сезонные чистящие наборы), скорректированы цены на 12 позиций согласно новым закупочным. Готово к рассылке партнёрам.';
  const t5Summary = 'Прайс-лист обновлён и прошёл проверку — подтвердите рассылку партнёрам.';
  const t5Steps = [
    { kind: 'task_created', ts: t5Created, data: { taskId: t5, title: 'Обновление сезонного прайс-листа' } },
    roleStep('task_triaged', t5, { result: { level: 'medium', departments: ['marketing'], confidence: 0.89, reason: 'Задача одного отдела — обновление прайс-листа.' } }, 340, 100, 1100, t5Created + 3000),
    roleStep('plan_created', t5, { plan: { blocks: [t5Block] } }, 460, 180, 1450, t5Created + 8000),
    roleStep('work_result', t5, { blockId: 'b1', department: 'marketing', result: { status: 'done', artifact: t5Artifact, used_sources: ['d-marketing-tone'] } }, 540, 210, 1750, t5Created + 15000),
    roleStep('review_verdict', t5, { blockId: 'b1', cycle: 0, result: { verdict: 'pass', issues: [] } }, 290, 75, 1000, t5Created + 20000),
    roleStep('acceptance_verdict', t5, { result: { verdict: 'accept', unmet_requirements: [], comment: t5Summary } }, 410, 135, 1300, t5Created + 26000),
    { kind: 'approval_requested', ts: t5Created + 27000, data: { taskId: t5, type: 'send_message', summary: t5Summary, artifact: t5Artifact } },
  ];
  const t5Cost = t5Steps.reduce((s, st) => s + (st.data.costUsd || 0), 0);
  store.tasks[t5] = {
    id: t5, title: 'Обновление сезонного прайс-листа', status: 'running', level: 'medium',
    createdAt: t5Created, steps: t5Steps, totalCostUsd: t5Cost, departments: new Set(['marketing']),
    direct: false, summary: null, artifact: null, durationMs: null,
  };
  (store.todos.marketing = store.todos.marketing || []).push({ id: `${t5}-b1`, board: 'marketing', title: t5Block.title, status: 'review', blockId: 'b1', taskId: t5, deps: [] });
  store.interactions['seed_int_1'] = {
    id: 'seed_int_1', taskId: t5, kind: 'approval', type: 'send_message', summary: t5Summary, artifact: t5Artifact,
  };

  // порядок — от новых к старым, как формирует startTask() в реальном пайплайне
  store.taskOrder.push(t5, t4, t1, t2, t3);
}
