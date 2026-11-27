const profiles = [
	{ 
		cred: "",
		accountName: "",
		email: ""
	}
];

const discordApp = [
	{
		notify: true,
		myDiscordID: '',
		discordWebhook: ''
	}
];

const Settings = {
	platform: "3",
	vName: "1.0.0",
	appCode: "endfield",
	serverDailyReset: "03:00:00", //format "HH:MM:SS"
	serverWeelyReset: [1, "03:00:00"], //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverArsenalReset: [3, "11:00:00"], //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverEowReset: [4, "03:00:00"],  //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverBPCycleStart: "2026-10-15 11:00:00", //format "YYYY-MM-DD HH:MM:SS"
	serverBPCycleEnd: [41, "05:00:00"], //format [Cycle, HH:MM:SS] *Cycle = number of days (normally 35, 42, 49 days)
	discordColumn: 2, //max 3 col in 1 row
	discordUseEdit: true, //update with edit post
	discordDailyPost: true, //new post everyday follow discordResetTime
	discordProfilesPerPost: 6, //max profiles per discord post/message
	energyFocus: { regen: 432e3, focus: [160, 200, 240] },
	cardMode: { blockTime: false, exponentialMovingAverage: false, aicUsePercent: true },
	webCFG: { columns: 'auto', minColWidth: '300px', gridGap: '15px' },
	retry: { batchSize: 20, max: 5, initialBackoffMs: 500, maxBackoffMs: 5000, randThreshold: 0.2 },
	endpoints: {
		refresh: "https://zonai.skport.com/web/v1/auth/refresh",
		binding: "https://zonai.skport.com/api/v1/game/player/binding",
		attendance: "https://zonai.skport.com/web/v1/game/endfield/attendance",
		card: "https://zonai.skport.com/api/v1/game/endfield/card/detail"
	},
	userAgent: "Mozilla/5.0",
	defaultHeaders: {
		accept: "application/json, text/plain, */*",
		origin: "https://game.skport.com",
		referer: "https://game.skport.com/"
	},
	baseAttHeaders: {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9",
		"Content-Type": "application/json",
		"sk-language": "en",
		Origin: "https://game.skport.com",
		Connection: "keep-alive"
	},
	successCodes: { 0: "✅ Check-in Successful", 10001: "✅ Ready to check-in" },
	skipCodes: { 10000: "Cookie Expired", 10002: "User Not Logged In" },
	skipError: { "HTML": "Invalid HTML Response / Cloudflare Error", 403: "Forbidden / Access Denied", 500: "Internal Server Error", 502: "Bad Gateway", 504: "Gateway Timeout" }
};

function main() {
	if (!profiles.length) return [];
	let tokens = chunkedFetchAll(profiles.map(buildTokenRefresh), r => !!readMeta(r)?.json?.data?.token || getSkipReason(r) !== null).map(r => readMeta(r)?.json?.data?.token || "");
	let resolved = profiles.map((p, i) => ({ ...p, token: tokens[i], skGameRole: p.skGameRole || "", nickname: p.accountName || "", uid: p.uid || "", serverName: p.serverName || "", playerCard: {} }));
	let idxs = resolved.map((p, i) => p.token ? i : -1).filter(i => i !== -1);

	if (idxs.length) {
		let binds = chunkedFetchAll(idxs.map(i => buildPlayerBindingRequest(resolved[i].cred, resolved[i].token)), isValidResp);
		idxs.forEach((i, k) => {
			resolved[i].bind = readMeta(binds[k]);
			let b = resolved[i].bind?.json?.data?.list?.find(a => a.appCode === Settings.appCode)?.bindingList?.[0], r = b?.defaultRole || b?.roles?.[0];
			if (r) Object.assign(resolved[i], { skGameRole: `${b.gameId}_${r.roleId}_${r.serverId}`, uid: r.roleId, nickname: r.nickname, serverName: r.serverName });
		});

		let cards = chunkedFetchAll(idxs.map(i => buildCardRequest(resolved[i].cred, resolved[i].token)), isValidResp);
		idxs.forEach((i, k) => { resolved[i].playerCard = readMeta(cards[k]).json?.data?.detail || {}; });

		let atts = chunkedFetchAll(idxs.map(i => buildAttendRequest(resolved[i], resolved[i].token)), isValidResp);
		idxs.forEach((i, k) => { resolved[i].meta = readMeta(atts[k]); });
	}

	let results = resolved.map((p, i) => formatResult(p, p.meta, i));
	discordPost(results); handleErrorAlerts(results); saveWebData(results);
}

function formatResult(p, meta, i) {
	let store = PropertiesService.getScriptProperties(), key = "reward_db", now = Date.now(), tr = n => typeof DomainLib !== "undefined" ? (DomainLib?.translate?.(n) || n) : n, skip = getSkipReason(meta?.resp);
	let db = Object.assign({ updatedAt: 0, items: {}, accounts: {} }, JSON.parse(store.getProperty(key) || "{}")), out = { nickname: p.nickname || `#${i + 1}`, serverName: p.serverName || "", uid: p.uid || "", skGameRole: p.skGameRole || "", success: false, status: "", msg: "", raw: (meta?.rawText || "").slice(0, 2000), itemIcon_url: [], playerCard: p?.playerCard ?? {} };
	if (!db.updatedAt) db.updatedAt = now;
	if (skip) { out.status = `❌ ${skip}`; out.msg = meta?.json?.message || skip; }
	else if (!meta?.json) { out.status = "💥 Invalid JSON"; out.msg = meta?.rawText ? `HTML Error (Preview: ${meta.rawText.slice(0, 50).trim()}...)` : "No response"; }
	else {
		let j = meta.json, acc = p.skGameRole || `#${i + 1}`;
		if (isSuccess(j.code)) {
			out.success = true; out.status = Settings.successCodes[j.code];
			if (j.code === 0) {
				db = Object.prototype.hasOwnProperty.call(db.accounts, acc) ? { updatedAt: now, items: {}, accounts: {} } : (db.updatedAt = now, db);
				let map = db.accounts[acc] = db.accounts[acc] || {};
				(j.data?.awardIds || []).forEach(a => { let id = String(a?.id ?? a), res = j.data.resourceInfoMap?.[id], c = Number(res?.count); if (res) db.items[id] = [`🎁 ${tr(res.name)}`, res.icon || db.items[id]?.[1] || ""]; map[id] = (Number(map[id]) || 0) + (Number.isFinite(c) && c >= 0 ? c : 0); });
				store.setProperty(key, JSON.stringify(db));
			}
			let map = db.accounts[acc] || {}, ids = Object.keys(map).filter(id => (Number(map[id]) || 0) > 0 && db.items[id]);
			out.msg = ids.length ? ids.map(id => `${db.items[id][0]} x${map[id]}`).join("\n") : "🎁 Successfully claimed"; out.itemIcon_url = ids.map(id => db.items[id][1]).filter(Boolean);
		} else { out.status = `❌ Error (Code: ${j.code})`; out.msg = j.message || "Unknown Error"; }
	}
	Settings.dailyUpdatedAt = db.updatedAt;
	console.log(`[${out.nickname} (${out.serverName})]\n🆔 ${out.uid}\n${out.status}\n${out.msg}${typeof buildPlayerCard !== "undefined" ? buildPlayerCard(p) : ""}`);
	return out;
}

function discordPost(rows, colCount = Settings.discordColumn || 2, useEdit = Settings.discordUseEdit || false) {
	const store = PropertiesService.getScriptProperties(), key = "discord_db", k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join(""), hooks = discordApp.filter(o => o.notify && o.discordWebhook), rewardUpdatedAt = Number(Settings.dailyUpdatedAt || 0);
	let db = Object.assign({ updatedAt: 0, msgMap: {} }, JSON.parse(store.getProperty(key) || "{}"));
	if (!useEdit || (useEdit && Settings.discordDailyPost && rewardUpdatedAt && db.updatedAt !== rewardUpdatedAt)) db = { updatedAt: rewardUpdatedAt, msgMap: {} };
	db.msgMap = db.msgMap || {};
	const getReset = (type, opt, extra) => { const n = new Date(), o = type == 'cycle' ? extra : opt, [a, rt = "00:00:00"] = Array.isArray(o) ? (type == 'daily' ? [0, o[0]] : o) : [o?.wd ?? o?.cyc ?? 0, o?.rt ?? o], t = new Date(n); t.setHours(...rt.split(':'), 0); if (type != 'cycle') { const d = type == 'weekly' ? (a - n.getDay() + 7) % 7 : 0; t.setDate(t.getDate() + d + (!d && t <= n ? (type == 'weekly' ? 7 : 1) : 0)); return Math.floor(t / 1000); } const b = new Date(opt.replace(" ", "T")), cyc = a * 864e5; b.setHours(...rt.split(':'), 0); return Math.floor((+b + Math.ceil((n - b + 1) / cyc) * cyc) / 1000); };
	let maxP = Settings.discordProfilesPerPost || 6, rowChunks = Array.from({ length: Math.ceil(rows.length / maxP) }, (_, i) => rows.slice(i * maxP, (i + 1) * maxP));
	hooks.forEach(h => {
		const hash = k(h.discordWebhook), savedMap = db.msgMap[hash], msgIds = Array.isArray(savedMap) ? savedMap : (savedMap ? [savedMap] : []), newMsgIds = [];
		rowChunks.forEach((chunk, idx) => {
			const embed = { title: `📝 Endfield - Report${rowChunks.length > 1 ? ` (${idx + 1}/${rowChunks.length})` : ""} [<t:${nowTs()}:d>]`, color: chunk.every(r => r.success) ? [0xFF0000, 0xFFFF00, 0xFF69B4, 0x00A86B, 0xFFA500, 0x00BFFF, 0x800080][new Date().getDay()] : 0x2F3136, thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" }, fields: [{ name: "**Useful Link**", value: "[App](https://script.google.com/home/my) | [Home](https://endfield.gryphline.com/) | [Sched](https://endfield.gryphline.com/en-us#calendar) | [SKP](https://www.skport.com/) | [Wiki](https://wiki.skport.com/endfield) | [Guide](https://www.prydwen.gg/arknights-endfield/) | [Map](https://opendfieldmap.org/) | [BP#1](https://endfieldtools.dev/community-factories/) | [BP#2](https://talospioneers.com) | [Ess](https://endfieldtools.dev/weapon-essence-solver/)", inline: false }, { name: "**Server Reset**", value: `🌸 Daily: <t:${getReset('daily', Settings.serverDailyReset)}:R>\n🛒 Arsenal: <t:${getReset('weekly', Settings.serverArsenalReset)}:R>\n⚔️ EoW: <t:${getReset('weekly', Settings.serverEowReset)}:R>`, inline: true }, { name: `\u200B`, value: `📅 Weekly: <t:${getReset('weekly', Settings.serverWeelyReset)}:R>\n🌟 BP: <t:${getReset('cycle', Settings.serverBPCycleStart, Settings.serverBPCycleEnd)}:R>`, inline: true }, { name: "", value: "", inline: false }, ...chunk.flatMap((r, i) => [{ name: `👤 **${r.nickname} (${r.serverName})**\n🆔 \`${r.uid}\``, value: `**Status:**\n\u2003${r.status}\n**Response:**\n\u2003${r.msg.replace(/\n/g, '\n\u2003')}${buildPlayerCard(r, true).replace(/\n/g, '\n\u2003')}`, inline: true }, ...((i + 1) % colCount === 0 && i + 1 < chunk.length ? [{ name: "", value: "", inline: false }] : [])])], footer: { text: "Updated on", icon_url: "https://assets.skport.com/assets/favicon.ico" }, timestamp: new Date().toISOString() };
			const existingId = msgIds[idx], canEdit = useEdit && !!existingId, payload = JSON.stringify({ username: "Endfield Assistant", avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png", embeds: [embed] });
			try {
				let res = chunkedFetchAll([{ url: canEdit ? `${h.discordWebhook}/messages/${existingId}` : `${h.discordWebhook}?wait=true`, method: canEdit ? "PATCH" : "POST", payload, contentType: "application/json", muteHttpExceptions: true, skipRetryCodes: [404] }])[0], m = readMeta(res);
				if (m.code >= 200 && m.code < 300) newMsgIds.push(canEdit ? existingId : (m.json?.id || existingId));
				else if (canEdit && m.code === 404) { let pr = chunkedFetchAll([{ url: `${h.discordWebhook}?wait=true`, method: "POST", payload, contentType: "application/json", muteHttpExceptions: true }])[0], pm = readMeta(pr); newMsgIds.push(pm.code >= 200 && pm.code < 300 && pm.json?.id ? pm.json.id : existingId); }
				else if (existingId) newMsgIds.push(existingId);
			} catch (e) { console.error(`Discord Error: ${e.message}`); if (existingId) newMsgIds.push(existingId); }
		});
		if (newMsgIds.length) db.msgMap[hash] = newMsgIds;
	});
	if (rewardUpdatedAt) db.updatedAt = rewardUpdatedAt;
	store.setProperty(key, JSON.stringify(db));
}

function handleErrorAlerts(rows) {
	const store = PropertiesService.getScriptProperties(), key = "discord_error_db", k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join("");
	let db = Object.assign({ msgMap: {} }, JSON.parse(store.getProperty(key) || "{}")), errors = rows.filter(r => !r.success);
	db.msgMap = db.msgMap || {};
	discordApp.forEach(app => {
		if (!app.notify || !app.myDiscordID || !app.discordWebhook) return;
		let target = app.dmWebhook || app.discordWebhook, hash = k(target), existingId = db.msgMap[hash] || "";
		if (errors.length) {
			let canEdit = !!existingId, payload = JSON.stringify({ username: "Endfield Assistant", avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png", content: `<@${app.myDiscordID}> ⚠️ **Found an error in the game account. Please check and fix it urgently.!**`, embeds: [{ title: "🚨 Endfield - Account Error Report", color: 0xFF0000, fields: errors.map(e => ({ name: `👤 **${e.nickname} (${e.serverName})**`, value: `**Status:** ${e.status}\n**Details:** ${e.msg}`, inline: false })), footer: { text: "Updated on", icon_url: "https://assets.skport.com/assets/favicon.ico" }, timestamp: new Date().toISOString() }] });
			try {
				let res = chunkedFetchAll([{ url: canEdit ? `${target}/messages/${existingId}` : `${target}?wait=true`, method: canEdit ? "PATCH" : "POST", payload, contentType: "application/json", muteHttpExceptions: true, skipRetryCodes: [404] }])[0], m = readMeta(res);
				if (m.code < 300) db.msgMap[hash] = m.json?.id || existingId;
				else if (canEdit && m.code === 404) { let newRes = chunkedFetchAll([{ url: `${target}?wait=true`, method: "POST", payload, contentType: "application/json", muteHttpExceptions: true }])[0], newM = readMeta(newRes); if (newM.code < 300 && newM.json?.id) db.msgMap[hash] = newM.json.id; }
			} catch (e) { console.error(`Error Alert Failed: ${e.message}`); }
		} else if (existingId) {
			try { chunkedFetchAll([{ url: `${target}/messages/${existingId}`, method: "DELETE", muteHttpExceptions: true }]); delete db.msgMap[hash]; } catch (e) { console.error(`Delete Error Msg Failed: ${e.message}`); }
		}
	});
	store.setProperty(key, JSON.stringify(db));
}

const buildPlayerCard = (p, b = false) => {
	if (!p?.playerCard || !p?.skGameRole) return "";
	let s = PropertiesService.getScriptProperties(), rKey = p.skGameRole, now = Date.now(), key = "card_db", dc = Settings.discordColumn === 1;
	let { energyFocus: { regen: rgt = 432e3, focus: enf = [] } = {}, cardMode: { blockTime: bt = false, exponentialMovingAverage: ema = false, aicUsePercent: apc = false } = {} } = Settings || {};
	let { base: bs = {}, domain: dl = [], dungeon: dg = {}, bpSystem: bp = {}, dailyMission: dm = {}, weeklyMission: wm = {} } = p.playerCard;
	let en = +dg.curStamina || 0, em = +dg.maxStamina || 0, db = JSON.parse(s.getProperty(key) || "{}"), acc = db[rKey] || { updatedAt: now, sta: { curStamina: en, maxTs: +dg.maxTs || now }, aic: [] };
	let oldUpd = acc.updatedAt || now; acc.updatedAt = now; let baseTs = (+en >= (acc?.sta?.curStamina ?? -1) ? acc?.sta?.maxTs : null) || +dg.maxTs || now;
	let savedTs = baseTs > 1e11 ? baseTs : baseTs * 1e3; if (bt) savedTs = Math.floor(savedTs / 36e5) * 36e5 + Math.floor((savedTs % 36e5) / rgt) * rgt;
	if (dg.maxTs !== undefined) dg.maxTs = savedTs; acc.sta = { curStamina: en, maxTs: savedTs };
	let wrap = t => b ? `\`${t}\`` : t, tr = n => typeof DomainLib !== 'undefined' ? (DomainLib?.translate?.(n) || n) : n;
	let fmt = ts => {
		if (!ts) return "-";
		let sec = (ts > 1e11 ? ts / 1e3 : ts) | 0; if (b) return `<t:${sec}:R>`;
		let d = ((sec - now / 1e3) | 0), a = Math.abs(d), f = (n, u) => d > 0 ? `in ${n} ${u}${n > 1 ? "s" : ""}` : `${n} ${u}${n > 1 ? "s" : ""} ago`;
		return a < 60 ? f(a, "sec") : a < 3600 ? f((a / 60) | 0, "min") : a < 864e2 ? f((a / 3600) | 0, "hour") : a < 6048e2 ? f((a / 864e2) | 0, "day") : a < 2592e3 ? f((a / 6048e2) | 0, "week") : a < 31536e3 ? f((a / 2592e3) | 0, "month") : f((a / 31536e3) | 0, "year");
	};
	let shn = (n, d = 2) => {
		let u = ["", "k", "m", "b", "t", "qa", "qi", "sx", "sp", "oc", "no", "dc"], i = 0, num = +n || 0;
		while (num >= 1e3 && i < u.length - 1) { num /= 1e3; i++; }
		return (Number.isInteger(num) ? num.toString() : num.toFixed(d).replace(/\.?0+$/, "")) + u[i];
	};
	let accAic = Array.isArray(acc.aic) ? acc.aic : (acc.aic = []), aSum = 0, aMax = 0, aStr = "", mins = (now - oldUpd) / 6e4;
	dl.forEach((d, dIdx) => {
		let domAic = accAic[dIdx] || (accAic[dIdx] = []), vIdx = 0;
		d.settlements = (d.settlements || []).map(x => {
			if (+x.level <= 0) return x;
			let sIdx = vIdx++, sum = +x.remainMoney, max = +x.moneyMax, isFull = sum >= max, old = domAic[sIdx] || {}, rate = old.rate || 0, maxTs = old.maxTs || null;
			if (!isFull) { let diff = sum - (old.curMoney || 0); if (mins >= 1 && diff > 0) { let calc = diff / mins; rate = ema && rate > 0 ? (calc > rate + 3 ? rate + 1.2 : rate - 0.7 + calc * 0.3) : calc; } maxTs = (rate > 0 && max - sum > 0) ? Math.floor(now + ((max - sum) / rate) * 6e4) : null; }
			else { rate = 0; maxTs = null; }
			domAic[sIdx] = { curMoney: sum, rate, maxTs };
			return { ...x, rate, maxTs };
		});
		let sList = d.settlements.filter(x => +x.level > 0), cur = sList.reduce((a, x) => a + +x.remainMoney, 0), max = sList.reduce((a, x) => a + +x.moneyMax, 0), fd = sList.filter(x => +x.remainMoney === +x.moneyMax).length;
		let rList = sList.map((x, i) => { let isFull = +x.remainMoney >= +x.moneyMax, pct = ((+x.remainMoney / +x.moneyMax) * 100).toFixed(2) + "%", remStr = `${shn(x.remainMoney)}/${shn(x.moneyMax)}`; return dc ? `\u2003\u2003[${i + 1}]: ${tr(x.name)}\n\u2003\u2003\u2003— ${remStr} | ${isFull ? wrap("Fulled") : (x.maxTs ? `${apc ? pct : `+${shn(x.rate)}/m`}, ~${fmt(x.maxTs)}` : pct)}` : `\u2003\u2003[${i + 1}]: ${remStr}`; }).join("\n");
		aSum += cur; aMax += max;
		aStr += `\n\u2003→ ${tr(d.name)} [${fd}/${sList.length}]: ${(sList.length && fd === sList.length) ? wrap("Fulled") : (max ? ((cur / max) * 100).toFixed(2) : "0.00") + "%"}${rList ? "\n" + rList : ""}`;
	});
	db[rKey] = acc; s.setProperty(key, JSON.stringify(db));
	let fStr = Array.isArray(enf) && enf.length ? "\n" + [...new Set(em != null ? [...enf, em] : enf)].map(v => `\u2003→ ${v}: ${en >= v ? wrap("Fulled") : fmt(savedTs + (v - em) * rgt)}`).join("\n") : "";
	return `\n🔑 Login: ${fmt(bs.lastLoginTime * 1e3)}\n🌸 Daily: ${dm.dailyActivation ?? 0}/${dm.maxDailyActivation ?? 0}\n📅 Weekly: ${wm.score ?? 0}/${wm.total ?? 0}\n🌟 BP: ${bp.curLevel ?? 0}/${bp.maxLevel ?? 0}\n⚡️ Energy: ${en}/${em}${fStr}\n🏠 AIC Funds: ${aMax ? ((aSum / aMax) * 100).toFixed(2) : "0.00"}%${aStr}`;
};

function doGet(e) {
	return HtmlService.createHtmlOutputFromFile('Index').setTitle('Endfield - Dashboard').addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getWebData() {
	let p = "web_chunk_", k = "web_meta", cmk = "cache_meta", cp = "cache_chunk_", sz = 80000, all = PropertiesService.getScriptProperties().getProperties(), m = JSON.parse(all[k] || "null"), u = m?.updatedAt || 0, n = +m?.chunks | 0, fb = { updatedAt: u || Date.now(), accounts: [] };
	if (n < 1) { console.log("[getWebData] No chunks in properties, returning fallback"); return fb; }
	let cache = CacheService.getScriptCache();
	try { let cm = JSON.parse(cache.get(cmk) || "null"); if (cm?.updatedAt === u && +cm?.chunks > 0) { let ks = Array.from({ length: +cm.chunks }, (_, i) => cp + i), mp = cache.getAll(ks), cr = ks.map(x => mp[x] || "").join(""); if (cr) { let out = JSON.parse(cr) || fb; console.log(`[getWebData] Using cached data (${+cm.chunks} chunks)`); return out; } } } catch (e) { console.warn(`[getWebData] Cache read failed: ${e.message}`); }
	let raw = ""; for (let i = 0; i < n; i++) raw += all[p + i] || "";
	if (!raw) { console.log("[getWebData] Empty property chunks, returning fallback"); return fb; }
	try { let parsed = JSON.parse(raw) || fb, cnt = Math.ceil(raw.length / sz), cb = { [cmk]: JSON.stringify({ updatedAt: u, chunks: cnt }) }; for (let i = 0; i < cnt; i++) cb[cp + i] = raw.slice(i * sz, (i + 1) * sz); try { cache.putAll(cb, 21600); console.log(`[getWebData] Built and saved cache (${cnt} chunks)`); } catch (e) { console.warn(`[getWebData] Cache write failed: ${e.message}`); } return parsed; } catch (e) { console.warn(`[getWebData] Parse failed, returning fallback: ${e.message}`); return fb; }
}

function getNextResetTimestamps(st) {
	let now = new Date(), nowMs = now.getTime();
	let setT = (d, t) => { let [h, m, s] = t.split(':').map(Number); d.setHours(h, m, s, 0); return d; };
	let ts = d => Math.floor(d.getTime() / 1000);
	let nTd = (t, d = setT(new Date(now), t)) => { if (d <= now) d.setDate(d.getDate() + 1); return ts(d); };
	let nDoW = (dow, t, d = setT(new Date(now), t)) => { let df = dow - d.getDay(); if (df < 0 || (df === 0 && d <= now)) df += 7; d.setDate(d.getDate() + df); return ts(d); };
	let nBp = (sStr, [cDays, t]) => {
		let sMs = new Date(sStr).getTime(), cMs = cDays * 864e5;
		if (nowMs < sMs) return Math.floor(sMs / 1000);
		let d = setT(new Date(sMs + (Math.floor((nowMs - sMs) / cMs) + 1) * cMs), t);
		if (d.getTime() <= nowMs) d.setTime(d.getTime() + cMs);
		return ts(d);
	};
	return { daily: nTd(st.serverDailyReset), weekly: nDoW(st.serverWeelyReset[0], st.serverWeelyReset[1]), arsenal: nDoW(st.serverArsenalReset[0], st.serverArsenalReset[1]), bp: nBp(st.serverBPCycleStart, st.serverBPCycleEnd), eow: nDoW(st.serverEowReset[0], st.serverEowReset[1]) };
}

function saveWebData(res) {
	let s = PropertiesService.getScriptProperties(), u = Date.now(), tr = n => (typeof DomainLib !== "undefined" && DomainLib?.translate?.(n)) || n, cSize = 8000, cPrefix = "web_chunk_", mKey = "web_meta", cmk = "cache_meta", cp = "cache_chunk_";
	let { energyFocus: { regen: rgt = 432e3, focus: enf = [160, 200, 240] } = {}, cardMode: { blockTime: bt = false, exponentialMovingAverage: ema = false, aicUsePercent: apc = false } = {}, webCFG: { columns: col = "auto", minColWidth: mcw = "300px", gridGap: gg = "15px", ipCacheKey: ipKey = "ef_dashboard_cache", ipCacheTtl: ipTtl = 216e5, keepViewLog: kvl = false } = {} } = Settings || {};
	let d = JSON.stringify({ updatedAt: u, serverReset: typeof getNextResetTimestamps === "function" ? getNextResetTimestamps(Settings) : null, tz: Session.getTimeZone(), energyFocus: { regen: rgt, focus: Array.isArray(enf) ? [...enf] : [] }, cardMode: { blockTime: bt, exponentialMovingAverage: ema, aicPercent: apc }, webCFG: { columns: col, minColWidth: mcw, gridGap: gg, ipCacheKey: ipKey, ipCacheTtl: ipTtl, keepViewLog: !!kvl }, accounts: (Array.isArray(res) ? res : []).map(p => { let cp = p?.playerCard, dg = cp?.dungeon, bp = cp?.bpSystem, dm = cp?.dailyMission, wm = cp?.weeklyMission; return { nickname: p?.nickname || "", uid: p?.uid || "", serverName: p?.serverName || "", success: !!p?.success, status: p?.status || "", msg: p?.msg || "", itemIcon_url: p?.itemIcon_url || [], skGameRole: p?.skGameRole || "", playerCard: cp?.base ? { base: { lastLoginTime: cp.base.lastLoginTime, avatarUrl: cp.base.avatarUrl }, dungeon: dg && { curStamina: dg.curStamina, maxStamina: dg.maxStamina, maxTs: dg.maxTs }, bpSystem: bp && { curLevel: bp.curLevel, maxLevel: bp.maxLevel }, dailyMission: dm && { dailyActivation: dm.dailyActivation, maxDailyActivation: dm.maxDailyActivation }, weeklyMission: wm && { score: wm.score, total: wm.total }, domain: (cp.domain || []).map(dom => ({ name: tr(dom.name), settlements: (dom.settlements || []).filter(x => +x.level > 0).map(({ level, name, remainMoney, moneyMax, rate, maxTs }) => ({ level, name: tr(name), remainMoney, moneyMax, rate: rate || 0, maxTs: maxTs || null })) })) } : null }; }) });
	let sz = Math.max(500, +cSize || 8000), n = Math.ceil(d.length / sz), all = s.getProperties(), batch = { [mKey]: JSON.stringify({ chunks: n, updatedAt: u }) };
	Object.keys(all).forEach(k => (k.startsWith(cPrefix) || k === mKey) && s.deleteProperty(k));
	for (let i = 0; i < n; i++) batch[cPrefix + i] = d.slice(i * sz, (i + 1) * sz); s.setProperties(batch);
	try { let cache = CacheService.getScriptCache(), oldN = +JSON.parse(cache.get(cmk) || "null")?.chunks | 0; cache.removeAll([cmk, ...Array.from({ length: Math.max(oldN, 20) }, (_, i) => cp + i)]); } catch (_) {}
}

function getSkipReason(r) {
	if (!r) return null;
	const { code: c, json: j, rawText: t } = readMeta(r);
	if (j && j.code !== undefined) return isSuccess(j.code) ? null : (j.code in Settings.skipCodes ? Settings.skipCodes[j.code] || j.message || j.msg || `Error Code ${j.code}` : null);
	if (/<!doctype|<html|Cloudflare/i.test(t)) return Settings.skipError["HTML"] || "Invalid HTML Response / Cloudflare Error";
	return c in Settings.skipError ? Settings.skipError[c] || j?.message || j?.msg || `HTTP ${c}` : null;
}
const isSuccess = code => typeof Settings.successCodes[code] !== 'undefined';
const isValidResp = r => { let m = readMeta(r); return (m?.json && isSuccess(m.json.code)) || getSkipReason(r) !== null; };
const getCaller = () => { const s = new Error().stack?.split("\n").slice(1) || [], e = /^(getCaller|chunkedFetchAll|Array\.(forEach|map|filter|reduce|reduceRight|flat|flatMap|some|every|find|findIndex|findLast|findLastIndex|sort|from|of)|Function\.(call|apply|bind)|Object\.(<anonymous>|values|keys|entries)|Promise\.(then|catch|finally|all|allSettled|race|any)|new Promise|AsyncFunction|GeneratorFunction|Generator\.next|setTimeout|setInterval|queueMicrotask)$/; let p; for (const l of s) { const f = l.trim().match(/^at\s+(.+?)(?:\s+\((.+)\))?$/); if (!f) continue; const n = f[1], loc = f[2] || (/^.+:\d+:\d+$/.test(n) ? n : ""); if (loc && !p) p = loc; if (!/^.+:\d+:\d+$/.test(n) && !e.test(n) && !/^(native|node:)/.test(n)) return n; } return p || "anonymous"; };
const readMeta = r => ({ resp: r, json: parseJson(r?.getContentText() || ""), code: r?.getResponseCode() ?? null, rawText: r?.getContentText() || "" });
const readJson = (o, size = 5000) => { const s = new WeakSet(), str = JSON.stringify(o, (k, v) => typeof v === "object" && v ? (s.has(v) ? "[Circular]" : (s.add(v), v)) : v, 2); for (let i = 0; i < str.length; i += size) console.log(str.slice(i, i + size)); };
const parseJson = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const nowTs = () => String(Math.floor(Date.now() / 1000));
const bytesToHex = b => b.map(x => ("0" + ((x & 0xFF).toString(16))).slice(-2)).join("");
const checkDailyReset = (d, t = "00:00:00") => {
	let n = new Date(), [y, m, x] = (d || "").split("-").map(Number), td = new Date(n - n.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
	let r = !d || (g => (g.setDate(g.getDate() + 1), !(g > n)))(new Date(y, m - 1, x, ...t.split(":").map(Number)));
	return { date: r ? td : d, isReset: r };
};

function generateSign(path, body, ts, token, plat, v) {
	let hJson = JSON.stringify({ platform: String(plat), timestamp: String(ts), dId: "", vName: String(v) });
	let hmac = Utilities.computeHmacSha256Signature(path + (body || "") + ts + hJson, token || "");
	return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytesToHex(hmac)));
}

function chunkedFetchAll(reqs, isValid = r => r.getResponseCode() >= 200 && r.getResponseCode() < 300, tag = getCaller()) {
	const { retry: { batchSize: sz = 20, max = 5, initialBackoffMs: bf = 500, maxBackoffMs: mBf = 5000, randThreshold: rt = 0.2 } = {} } = Settings, err = m => ({ getContentText: () => JSON.stringify({ error: m }), getResponseCode: () => 0 });
	return Array.from({ length: Math.ceil(reqs.length / sz) }, (_, i) => [i, reqs.slice(i * sz, (i + 1) * sz)]).flatMap(([i, chk]) => {
		let res; try { res = UrlFetchApp.fetchAll(chk); } catch (e) { console.error(`[Batch ${i}][${tag}] Error: ${e.message}`); res = chk.map(() => err(e.message)); }
		return res.map((r, j) => {
			const idx = i * sz + j, rq = chk[j], p = `[#${idx}][${tag}]`;
			for (let a = 0, skip; a < max && !isValid(r); a++) {
				const { code, rawText: txt } = readMeta(r);
				if ((rq.skipRetryCodes || []).includes(code) ? (console.warn(`${p} Skipped retry for status ${code}`), 1) : (code !== 0 && !txt.includes("Address unavailable") && !txt.includes("DNS")) && (skip = getSkipReason(r)) && (console.warn(`${p} Skipped [${code}]: ${skip}`), 1)) break;
				let d = Math.min(bf * 2 ** a, mBf); d += Math.floor(Math.random() * d * rt); console.warn(`${p} [Retry ${a + 1}/${max}] (Status: ${code}) in ${d}ms`); Utilities.sleep(d);
				try { r = UrlFetchApp.fetch(rq.url, rq); } catch (e) { console.error(`${p} Fetch Error: ${e.message}`); r = err(e.message); }
			}
			return isValid(r) ? (console.log(`${p} Success: ${rq.url}`), r) : (console.error(`${p} Failed [${r.getResponseCode()}]: ${rq.url}`), r);
		});
	});
}

const buildTokenRefresh = p => ({ url: Settings.endpoints.refresh, method: "get", muteHttpExceptions: true, headers: { "User-Agent": Settings.userAgent, ...Settings.defaultHeaders, cred: p.cred, platform: Settings.platform, vName: Settings.vName } });
const buildPlayerBindingRequest = (cred, tk) => {
	let ts = nowTs(); return { url: Settings.endpoints.binding, method: "get", muteHttpExceptions: true, headers: { cred, platform: Settings.platform, vName: Settings.vName, timestamp: ts, "sk-language": "en", sign: generateSign("/api/v1/game/player/binding", "", ts, tk, Settings.platform, Settings.vName) } };
};
const buildCardRequest = (cred, tk) => {
	let ts = nowTs(); return { url: Settings.endpoints.card, method: "get", muteHttpExceptions: true, headers: { cred, platform: Settings.platform, vName: Settings.vName, timestamp: ts, "sk-language": "en", sign: generateSign("/api/v1/game/endfield/card/detail", "", ts, tk, Settings.platform, Settings.vName) } };
};
const buildAttendRequest = (p, tk) => {
	let body = JSON.stringify({ role: p.skGameRole }), ts = nowTs();
	return { url: Settings.endpoints.attendance, method: "post", contentType: "application/json", payload: body, muteHttpExceptions: true, headers: { ...Settings.baseAttHeaders, cred: p.cred, platform: Settings.platform, vName: Settings.vName, timestamp: ts, "sk-game-role": p.skGameRole, sign: generateSign("/web/v1/game/endfield/attendance", body, ts, tk, Settings.platform, Settings.vName) } };
};
