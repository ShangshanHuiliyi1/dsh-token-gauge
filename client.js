/**
 * Browser half of the token gauge bundle. It renders two independent readouts:
 *
 * 1. **Credit gauge** (`sidebar.footer.action`, anchored as a floating card
 *    directly above the sidebar's Settings row): a blue bar whose denominator
 *    is the account's whole remaining credit right after the last top-up, and
 *    whose numerator is what has been spent since then. A top-up is detected
 *    by the balance *rising*; the new balance immediately becomes the new
 *    denominator, so every recharge restarts the bar.
 *
 * 2. **Context usage** (`conversation.input.dock`, above the composer card):
 *    the same seat as before, now as plain text with no bar — the attached
 *    Session's context-window occupancy from the shipped `contextPressure`
 *    projection.
 *
 * @module @local/dsh-token-gauge/client
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-token-gauge',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');

    /** Locale namespace owned by this plugin. */
    const NS = 'token-gauge';
    /** Durable credit regime (baseline + last sample); a derived display cache. */
    const CREDIT_STORAGE_KEY = 'dsh.token-gauge.credit';
    /** Balance polling period while the page is visible. */
    const REFRESH_MS = 120_000;
    /** Balance growth above this counts as a top-up (half a cent). */
    const TOPUP_EPSILON = 0.005;
    /**
     * Client build version carried by account calls. The shipped account
     * package inlines the same deployment version; the Host forwards it as the
     * Platform request identity.
     */
    const CLIENT_VERSION = '0.2.0-rc.2';
    /** Fill ratio from which the bar warns, then errors, instead of staying blue. */
    const WARN_PERCENT = 75;
    const ERROR_PERCENT = 90;

    const CLASS = {
      anchor: 'dshTokenGaugeAnchor',
      anchorRail: 'dshTokenGaugeAnchorRail',
      card: 'dshTokenGaugeCard',
      rail: 'dshTokenGaugeRail',
      row: 'dshTokenGaugeRow',
      label: 'dshTokenGaugeLabel',
      amount: 'dshTokenGaugeAmount',
      track: 'dshTokenGaugeTrack',
      fill: 'dshTokenGaugeFill',
      fillWarn: 'dshTokenGaugeFillWarn',
      fillError: 'dshTokenGaugeFillError',
      railPercent: 'dshTokenGaugeRailPercent',
      note: 'dshTokenGaugeNote',
      context: 'dshTokenGaugeContext',
      contextValue: 'dshTokenGaugeContextValue',
    };

    /**
     * Layout contract.
     *
     * The card must never sit on top of the workspace list, so it does not float
     * at all: its anchor is a zero-width flex item in the sidebar's footer action
     * row whose `min-height` reserves real vertical space, and the card is pinned
     * to the bottom of that space (below the shipped Cordis badge, above the
     * Settings row). `regionArea` is the sidebar column's flexible child
     * (`flex:1; min-height:0; overflow:hidden`), so the footer growing by this
     * height simply makes the list that much shorter instead of being covered.
     *
     * The reserve is the shipped footer row (Cordis badge: `height:42px` plus
     * `margin-top:8px` = 50px) plus the card, plus a small breathing gap. Both
     * numbers are exposed as custom properties so they can be tuned without
     * touching the code.
     */
    const CSS = [
      `.${CLASS.anchor}{position:relative;flex:0 0 0;align-self:flex-end;width:0;min-width:0;min-height:var(--dsh-token-gauge-reserve,96px);overflow:visible}`,
      `.${CLASS.anchorRail}{min-height:var(--dsh-token-gauge-reserve-rail,74px)}`,
      `.${CLASS.card}{position:absolute;left:0;bottom:0;box-sizing:border-box;width:216px;height:40px;padding:6px 10px;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.18));color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;display:flex;flex-direction:column;justify-content:center;gap:6px;pointer-events:auto;cursor:pointer;text-align:left}`,
      `.${CLASS.card}:hover{border-color:var(--dsw-alias-border-l2)}`,
      `.${CLASS.card}:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px}`,
      `.${CLASS.row}{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}`,
      `.${CLASS.label}{color:var(--dsw-alias-label-tertiary);white-space:nowrap}`,
      `.${CLASS.amount}{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
      `.${CLASS.track}{height:6px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}`,
      `.${CLASS.fill}{height:100%;width:0;border-radius:999px;background:var(--dsw-alias-brand-primary,#3b82f6);transition:width .2s ease}`,
      `.${CLASS.fillWarn}{background:var(--dsw-alias-state-warn-primary)}`,
      `.${CLASS.fillError}{background:var(--dsw-alias-state-error-primary)}`,
      `.${CLASS.railPercent}{display:none;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:12px;font-variant-numeric:tabular-nums}`,
      `.${CLASS.note}{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
      // Collapsed sidebar (56px rail): the same card narrows to the percentage.
      `.${CLASS.rail}{width:36px;height:34px;padding:4px 2px;align-items:center;gap:3px}`,
      `.${CLASS.rail} .${CLASS.row}{display:none}`,
      `.${CLASS.rail} .${CLASS.railPercent}{display:block}`,
      `.${CLASS.rail} .${CLASS.track}{width:28px}`,
      // Context readout above the composer card: one short line, no bar.
      `.${CLASS.context}{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto;padding:0 2px 6px;display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:default;user-select:none}`,
      `.${CLASS.contextValue}{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}`,
    ].join('');

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'credit.used': '已用',
      'credit.left': '剩余',
      'credit.percent': '{percent}%',
      'credit.tip': '自 {time} 充值后总额度 {total}：已用 {used}（占 {percent}%），当前剩余 {left}。点击刷新余额。',
      'credit.unavailable': '额度不可用',
      'credit.unavailable.tip': '读取账户余额失败：账号可能未登录，或平台暂时不可用。点击重试。',
      'credit.missing': '额度服务不可用',
      'credit.missing.tip': '当前界面没有账户服务可调用。点击重试。',
      'credit.tokens.est': '≈ {tokens} tokens（按本次充值后的实际均价换算）',
      'credit.tokens.none': '暂无法换算成 tokens：本次充值后还没有可测量的消费',
      'context.used': '上下文已用',
      'context.unit': 'tokens',
    };

    /** English dictionary, key-complete against the Chinese one. */
    const en = {
      'credit.used': 'Used',
      'credit.left': 'Left',
      'credit.percent': '{percent}%',
      'credit.tip': 'Credit since the top-up at {time}: total {total}, used {used} ({percent}% of it), left {left}. Click to refresh.',
      'credit.unavailable': 'Credit unavailable',
      'credit.unavailable.tip': 'Reading the account balance failed: the account may be signed out, or the platform is unavailable. Click to retry.',
      'credit.missing': 'Credit service unavailable',
      'credit.missing.tip': 'This UI exposes no account service to call. Click to retry.',
      'credit.tokens.est': '≈ {tokens} tokens (converted at this top-up period\'s observed average price)',
      'credit.tokens.none': 'No token equivalent yet: nothing measurable has been spent since the top-up',
      'context.used': 'Context used',
      'context.unit': 'tokens',
    };

    function finiteNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }

    /** Thousands-separated integer for hover details: 3,456,789. */
    function formatCount(value) {
      return Number.isFinite(value) ? Math.round(value).toLocaleString() : '—';
    }

    /**
     * Billed tokens one session's `tokenUsage` projection reports.
     *
     * The four buckets are disjoint (reasoning rides inside output), matching
     * the shipped meter's own accounting.
     *
     * @param usage - the projection value, or anything else.
     * @returns the token total, or undefined when no usage column was served.
     */
    function usageTokensOf(usage) {
      if (usage === null || typeof usage !== 'object') return undefined;
      const total =
        (finiteNumber(usage.uncachedInputTokens) ?? 0) +
        (finiteNumber(usage.outputTokens) ?? 0) +
        (finiteNumber(usage.cacheReadTokens) ?? 0) +
        (finiteNumber(usage.cacheWriteTokens) ?? 0);
      return Math.round(total);
    }

    /**
     * Sum billed tokens over the session list's cached usage columns.
     *
     * @param items - `session.list` rows.
     * @returns `{tokens, sessions}`; `sessions` counts the rows that actually
     *   carried a usage column, so "no data" never reads as "zero tokens".
     */
    function tokensFromSessions(items) {
      let tokens = 0;
      let sessions = 0;
      for (const item of Array.isArray(items) ? items : []) {
        const usage = usageTokensOf(item?.projections?.values?.tokenUsage);
        if (usage === undefined) continue;
        tokens += usage;
        sessions += 1;
      }
      return { tokens, sessions };
    }

    /**
     * The regime's observed average price, in account currency per token.
     *
     * Both sides are measured over the same window — what the balance lost
     * since the top-up versus the billed tokens observed over that window — so
     * the figure self-calibrates instead of hardcoding a price list.
     *
     * @param regime - the stored credit regime.
     * @returns currency per token, or undefined while either side is missing.
     */
    function creditPrice(regime) {
      if (regime === null || typeof regime !== 'object') return undefined;
      const spent = (finiteNumber(regime.baseline) ?? 0) - (finiteNumber(regime.lastSeen) ?? 0);
      const atBaseline = finiteNumber(regime.tokensAtBaseline);
      const seen = finiteNumber(regime.tokensSeen);
      if (spent <= 0 || atBaseline === undefined || seen === undefined) return undefined;
      const tokens = seen - atBaseline;
      if (tokens <= 0) return undefined;
      return spent / tokens;
    }

    /**
     * Tokens one amount of credit equates to under the observed average price.
     *
     * @param regime - the stored credit regime.
     * @param amount - an amount in the regime's currency.
     * @returns whole tokens, or undefined when no price is established yet.
     */
    function tokensForMoney(regime, amount) {
      const price = creditPrice(regime);
      const value = finiteNumber(amount);
      if (price === undefined || price <= 0 || value === undefined) return undefined;
      return Math.round(value / price);
    }

    /** Compact token count: 1.2K / 3.45M / 1.20B. */
    function formatTokens(value) {
      const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
      if (!Number.isFinite(value)) return '—';
      if (value < 1e3) return String(Math.round(value));
      if (value < 1e6) return `${scaled(value / 1e3)}K`;
      if (value < 1e9) return `${scaled(value / 1e6)}M`;
      return `${scaled(value / 1e9)}B`;
    }

    /** `¥12.34` / `$12.34` / `12.34 EUR` for an unlabelled currency. */
    function formatMoney(amount, currency) {
      const value = Number.isFinite(amount) ? amount : 0;
      const digits = value.toFixed(2);
      if (currency === 'CNY') return `¥${digits}`;
      if (currency === 'USD') return `$${digits}`;
      return currency === '' || currency === undefined ? digits : `${digits} ${currency}`;
    }

    /** `MM-DD HH:mm` in local time, or '' when the instant is unknown. */
    function formatStamp(at) {
      if (typeof at !== 'number' || !Number.isFinite(at)) return '';
      const date = new Date(at);
      const pad = (part) => String(part).padStart(2, '0');
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /**
     * Sum every wallet of the account's dominant currency.
     *
     * The platform reports the recharge balance and granted bonus balances as
     * separate wallets; "the account's whole remaining credit" is both.
     *
     * @param balance - `AccountDetails['balance']` as the Host forwards it.
     * @returns the dominant currency's total, or null when nothing is readable.
     */
    function walletTotal(balance) {
      if (balance === null || typeof balance !== 'object' || balance.status !== 'ready') return null;
      const wallets = [...(Array.isArray(balance.value) ? balance.value : []), ...(Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [])];
      const totals = new Map();
      for (const wallet of wallets) {
        if (wallet === null || typeof wallet !== 'object') continue;
        const amount = Number(wallet.balance);
        if (!Number.isFinite(amount)) continue;
        const currency = typeof wallet.currency === 'string' ? wallet.currency : '';
        totals.set(currency, (totals.get(currency) ?? 0) + amount);
      }
      let best = null;
      for (const [currency, amount] of totals) if (best === null || amount > best.amount) best = { currency, amount };
      if (best === null) return null;
      return { currency: best.currency, amount: Math.round(best.amount * 100) / 100 };
    }

    function readStoredCredit() {
      try {
        const raw = window.localStorage.getItem(CREDIT_STORAGE_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return null;
        const baseline = finiteNumber(parsed.baseline);
        if (baseline === undefined || baseline <= 0) return null;
        return {
          currency: typeof parsed.currency === 'string' ? parsed.currency : '',
          baseline,
          baselineAt: finiteNumber(parsed.baselineAt),
          lastSeen: finiteNumber(parsed.lastSeen) ?? baseline,
          lastAt: finiteNumber(parsed.lastAt),
          tokensAtBaseline: finiteNumber(parsed.tokensAtBaseline),
          tokensSeen: finiteNumber(parsed.tokensSeen),
        };
      } catch {
        return null;
      }
    }

    function writeStoredCredit(regime) {
      try {
        window.localStorage.setItem(CREDIT_STORAGE_KEY, JSON.stringify(regime));
      } catch {
        // A blocked storage only costs the baseline across reloads.
      }
    }

    /**
     * Fold one balance sample into the stored regime.
     *
     * A sample that rises above the previous one is a recharge: the balance it
     * reports is the account's whole credit right after that recharge, which is
     * exactly the bar's denominator, so the bar restarts full — and the token
     * total observed at that moment becomes the price window's other end.
     *
     * @param stored - the previous regime, or null.
     * @param sample - `{currency, amount}`; null means "no reading this time".
     * @param tokens - billed tokens observed this round, or null/undefined when
     *   the usage columns were unavailable.
     * @returns the next regime (the previous one when nothing was read).
     */
    function advanceCredit(stored, sample, tokens) {
      const now = Date.now();
      if (sample === null) return stored;
      const { currency, amount } = sample;
      const observed = finiteNumber(tokens);
      const fresh = { currency, baseline: amount, baselineAt: now, lastSeen: amount, lastAt: now, tokensAtBaseline: observed, tokensSeen: observed };
      if (stored === null || stored.currency !== currency) return fresh;
      if (amount > stored.lastSeen + TOPUP_EPSILON) return fresh;
      // A regime stored before the token column existed adopts the current total
      // as its window start: earlier spend can no longer be matched to tokens.
      const tokensAtBaseline = stored.tokensAtBaseline ?? observed;
      return { ...stored, currency, lastSeen: amount, lastAt: now, tokensAtBaseline, tokensSeen: observed ?? stored.tokensSeen };
    }

    /**
     * Read the signed-in account's credit.
     *
     * @param ctx - client plugin context.
     * @returns `{kind: 'ok', sample}`, or `{kind: 'missing' | 'unavailable'}`
     *   with a `detail` string so the card can say why it has nothing to draw.
     */
    async function loadCredit(ctx) {
      let namespace;
      try {
        namespace = ctx.remote?.account;
      } catch (error) {
        return { kind: 'missing', detail: error instanceof Error ? error.message : String(error) };
      }
      const getBalance = namespace?.getBalance;
      if (typeof getBalance !== 'function') return { kind: 'missing', detail: 'remote.account exposes no getBalance' };
      const active = ctx.locale?.getSnapshot?.().active;
      const result = await getBalance.call(namespace, {
        version: CLIENT_VERSION,
        locale: typeof active === 'string' && active !== '' ? active : 'en',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      });
      if (result?.ok !== true) {
        const failure = result?.error;
        return { kind: 'unavailable', detail: failure === undefined ? 'balance call failed' : `${String(failure.code)}: ${String(failure.message)}` };
      }
      const sample = walletTotal(result.value);
      return sample === null ? { kind: 'unavailable', detail: 'the platform returned no readable wallet' } : { kind: 'ok', sample };
    }

    /**
     * Sum billed tokens over the visible session corpus.
     *
     * The account's price is account-wide, so the window's token side is taken
     * across every session the list knows — the shipped `tokenUsage` projection
     * arrives already computed in the list's cached column, so this reads
     * checkpoints rather than folding logs.
     *
     * @param ctx - client plugin context.
     * @returns the total, or null when no session served a usage column.
     */
    async function loadUsage(ctx) {
      let namespace;
      try {
        namespace = ctx.remote?.session;
      } catch {
        return null;
      }
      const list = namespace?.list;
      if (typeof list !== 'function') return null;
      const result = await list.call(namespace, {});
      if (result?.ok !== true) return null;
      const { tokens, sessions } = tokensFromSessions(result.value?.items);
      return sessions === 0 ? null : tokens;
    }

    /**
     * One refresh: the balance reading plus the billed-token total behind it.
     *
     * @param ctx - client plugin context.
     * @returns the balance outcome, carrying `tokens` when it succeeded.
     */
    async function loadSnapshot(ctx) {
      const credit = await loadCredit(ctx);
      if (credit.kind !== 'ok') return credit;
      const tokens = await loadUsage(ctx).catch(() => null);
      return { ...credit, tokens };
    }

    /**
     * The credit bar above the sidebar's Settings row.
     *
     * @param props - `wide` (sidebar column state), the locale seat, and this
     *   entry's injected snapshot reader (balance plus billed tokens).
     */
    function CreditGauge({ wide, t, loadSnapshot: load }) {
      const tr = typeof t === 'function' ? t : (key) => key;
      const [regime, setRegime] = React.useState(readStoredCredit);
      const [problem, setProblem] = React.useState(null);
      const [detail, setDetail] = React.useState('');
      const loaderRef = React.useRef(load);
      loaderRef.current = load;

      const tick = React.useCallback(async () => {
        const loader = loaderRef.current;
        if (typeof loader !== 'function') {
          setProblem('missing');
          setDetail('no balance reader was injected');
          return;
        }
        try {
          const outcome = await loader();
          if (outcome?.kind !== 'ok') {
            setProblem(outcome?.kind === 'missing' ? 'missing' : 'unavailable');
            setDetail(typeof outcome?.detail === 'string' ? outcome.detail : '');
            return;
          }
          setProblem(null);
          setDetail('');
          const stored = readStoredCredit();
          const next = advanceCredit(stored, outcome.sample, outcome.tokens);
          if (next === null) return;
          // Only publish a real change: an identical sample keeps the same card.
          if (
            stored !== null &&
            stored.currency === next.currency &&
            stored.baseline === next.baseline &&
            stored.baselineAt === next.baselineAt &&
            stored.lastSeen === next.lastSeen &&
            stored.tokensSeen === next.tokensSeen
          ) {
            return;
          }
          writeStoredCredit(next);
          setRegime(next);
        } catch (error) {
          // A failed read keeps the last known regime on screen.
          setProblem('unavailable');
          setDetail(error instanceof Error ? error.message : String(error));
        }
      }, []);

      React.useEffect(() => {
        void tick();
        const timer = setInterval(() => {
          if (!document.hidden) void tick();
        }, REFRESH_MS);
        const onFocus = () => {
          void tick();
        };
        const onVisibility = () => {
          if (!document.hidden) void tick();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          clearInterval(timer);
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [tick]);

      // Nothing read yet and nothing stored: stay out of the way until we know.
      if (regime === null && problem === null) return null;

      const anchorClass = wide === false ? `${CLASS.anchor} ${CLASS.anchorRail}` : CLASS.anchor;
      const cardClass = wide === false ? `${CLASS.card} ${CLASS.rail}` : CLASS.card;
      if (regime === null) {
        const reason = problem === 'missing' ? tr('credit.missing.tip') : tr('credit.unavailable.tip');
        const tip = detail === '' ? reason : `${reason}\n${detail}`;
        return React.createElement(
          'div',
          { className: anchorClass, 'data-dsh-token-gauge': 'credit' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: cardClass,
              onClick: () => {
                void tick();
              },
              title: tip,
              'aria-label': tip,
            },
            React.createElement('span', { className: CLASS.note }, problem === 'missing' ? tr('credit.missing') : tr('credit.unavailable')),
          ),
        );
      }

      const used = Math.max(0, Math.round((regime.baseline - regime.lastSeen) * 100) / 100);
      const remaining = Math.max(0, regime.lastSeen);
      const percent = regime.baseline > 0 ? Math.min(100, Math.max(0, Math.round((used / regime.baseline) * 100))) : 0;
      const fillClass =
        percent >= ERROR_PERCENT ? `${CLASS.fill} ${CLASS.fillError}` : percent >= WARN_PERCENT ? `${CLASS.fill} ${CLASS.fillWarn}` : CLASS.fill;
      const stamp = formatStamp(regime.baselineAt);
      const reading = tr('credit.tip', {
        time: stamp === '' ? '—' : stamp,
        total: formatMoney(regime.baseline, regime.currency),
        used: formatMoney(used, regime.currency),
        percent,
        left: formatMoney(remaining, regime.currency),
      });
      // A refresh that failed behind a drawn card still says why on hover.
      const tip = detail === '' ? reading : `${reading}\n${detail}`;
      // Each figure answers "how many tokens is that?" on its own hover.
      const tokenTip = (tokens) => (tokens === undefined ? tr('credit.tokens.none') : tr('credit.tokens.est', { tokens: formatCount(tokens) }));
      const usedTip = tokenTip(tokensForMoney(regime, used));
      const leftTip = tokenTip(tokensForMoney(regime, remaining));

      return React.createElement(
        'div',
        { className: anchorClass, 'data-dsh-token-gauge': 'credit' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: cardClass,
            onClick: () => {
              void tick();
            },
            title: tip,
            'aria-label': tip,
          },
          React.createElement(
            'span',
            { className: CLASS.row },
            React.createElement(
              'span',
              { className: CLASS.label },
              tr('credit.used'),
              ' ',
              React.createElement('span', { className: CLASS.amount, title: usedTip }, formatMoney(used, regime.currency)),
            ),
            React.createElement(
              'span',
              { className: CLASS.label },
              tr('credit.left'),
              ' ',
              React.createElement('span', { className: CLASS.amount, title: leftTip }, formatMoney(remaining, regime.currency)),
            ),
          ),
          React.createElement(
            'span',
            { className: CLASS.track },
            React.createElement('span', { className: fillClass, style: { width: `${String(percent)}%` } }),
          ),
          // Collapsed rail: the numbers do not fit, the share does.
          React.createElement('span', { className: CLASS.railPercent }, tr('credit.percent', { percent })),
        ),
      );
    }

    /**
     * The context-window readout above the composer card: text only, no bar and
     * no share figure — the window's capacity and share stay on hover.
     *
     * @param props - the dock's standard kit plus its locale seat.
     */
    function ContextUsage({ useProjection, t }) {
      const readProjection = typeof useProjection === 'function' ? useProjection : () => undefined;
      const tr = typeof t === 'function' ? t : (key) => key;
      const pressure = readProjection('contextPressure');
      const used = finiteNumber(pressure?.projectedTokens) ?? finiteNumber(pressure?.pressureTokens);
      if (used === undefined) return null;
      const capacity = finiteNumber(pressure?.contextWindow);
      const bounded = capacity !== undefined && capacity > 0;
      const reading = `${tr('context.used')} ~${formatTokens(used)} ${tr('context.unit')}`;
      const tip = bounded
        ? `${reading} / ${formatTokens(capacity)} (${String(Math.min(100, Math.max(0, Math.round((used / capacity) * 100))))}%)`
        : reading;

      return React.createElement(
        'div',
        { className: CLASS.context, 'data-dsh-token-gauge': 'context', title: tip },
        React.createElement('span', null, tr('context.used')),
        ' ',
        React.createElement('span', { className: CLASS.contextValue }, `~${formatTokens(used)}`),
        ' ',
        React.createElement('span', null, tr('context.unit')),
      );
    }

    /**
     * The services this plugin needs.
     *
     * The dotted Remote namespaces are load-bearing: Cordis throws on an
     * undeclared dotted service instead of returning undefined, so a namespace
     * must be a declared dependency before `ctx.remote.<ns>` can be read at all.
     * `remote.account` answers the balance, `remote.session` the billed-token
     * total behind the card's price estimate. The shipped packages declare
     * theirs the same way (`["slots", "locale", "remote", "remote.account",
     * "remote.session", ...]` in the account UI).
     */
    const inject = ['slots', 'locale', 'remote', 'remote.account', 'remote.session'];

    /**
     * Register the stylesheet, the dictionaries, the sidebar card and the
     * composer readout.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const existing = document.querySelector('style[data-plugin-css="@local/dsh-token-gauge"]');
        if (existing !== null) return () => {};
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/dsh-token-gauge';
        tag.dataset.pluginCss = '@local/dsh-token-gauge';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'token-gauge: styles');

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-gauge: dictionaries');

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'token-gauge-credit',
            // First in the row: the zero-size anchor must sit at the row's
            // start so the card hangs from the sidebar's own content edge.
            order: -1,
            locale: NS,
            inject: () => ({ loadSnapshot: () => loadSnapshot(ctx) }),
          },
          CreditGauge,
        ),
      );

      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'token-gauge',
            order: 30,
            locale: NS,
          },
          ContextUsage,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.CreditGauge = CreditGauge;
    exports.ContextUsage = ContextUsage;
    // Pure helpers, exported the way shipped client packages export theirs so a
    // plain-JS check can exercise them without a browser.
    exports.advanceCredit = advanceCredit;
    exports.walletTotal = walletTotal;
    exports.formatMoney = formatMoney;
    exports.formatStamp = formatStamp;
    exports.tokensFromSessions = tokensFromSessions;
    exports.creditPrice = creditPrice;
    exports.tokensForMoney = tokensForMoney;
    return module.exports;
  },
});
