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
	discordResetTime: "23:00:00", //format "HH:MM:SS" *must same rewardResetTime and set when discordDailyPost = true
	rewardResetTime: "23:00:00", //format "HH:MM:SS"
	serverDailyReset: "03:00:00", //format "HH:MM:SS"
	serverWeelyReset: [1, "03:00:00"], //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverArsenalReset: [3, "11:00:00"], //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverEowReset: [4, "03:00:00"],  //format [MDay, HH:MM:SS] *MDay start 0 = sunday ~~ 6 = saturday
	serverBPCycleStart: "2026-10-15 11:00:00", //format "YYYY-MM-DD HH:MM:SS"
	serverBPCycleEnd: [41, "05:00:00"], //format [Cycle, HH:MM:SS] *Cycle = number of days (normally 35, 42, 49 days)
	discordColumn: 1, //max 3 col in 1 row
	discordUseEdit: true, //update with edit post
	discordDailyPost: true, //new post everyday follow discordResetTime
	discordProfilesPerPost: 6, //max profiles per discord post/message
	retry: { max: 5, initialBackoffMs: 500, maxBackoffMs: 5000 },
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
	chunkSize: 20,
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
	discordPost(results);
	handleErrorAlerts(results);
	saveWebData(results);
}

function formatResult(p, meta, i) {
	let store = PropertiesService.getScriptProperties(), key = "reward_db";
	let db = JSON.parse(store.getProperty(key) || '{"date":"","items":{},"accounts":{}}');
	let cr = checkDailyReset(db.date, Settings.rewardResetTime);
	let tr = n => typeof DomainLib !== 'undefined' ? (DomainLib?.translate?.(n) || n) : n;
	if (cr.isReset) store.setProperty(key, JSON.stringify(db = { date: cr.date, items: {}, accounts: {} }));
	
	let out = { nickname: p.nickname || `#${i + 1}`, serverName: p.serverName || "", uid: p.uid || "", skGameRole: p.skGameRole || "", success: false, status: "", msg: "", raw: (meta?.rawText || "").slice(0, 2000), itemIcon_url: [], playerCard: p?.playerCard ?? {} }, skip = getSkipReason(meta?.resp);
	
	if (skip) {
		out.status = `❌ ${skip}`; out.msg = meta?.json?.message || skip;
	} else if (!meta?.json) {
		out.status = "💥 Invalid JSON"; out.msg = meta?.rawText ? `HTML Error (Preview: ${meta.rawText.slice(0, 50).trim()}...)` : "No response";
	} else {
		let j = meta.json, acc = p.skGameRole || `#${i + 1}`;
		if (isSuccess(j.code)) {
			out.success = true; out.status = Settings.successCodes[j.code];
			let ids = j.code === 0 ? [...new Set((j.data?.awardIds || []).map(a => {
				let id = String(a?.id ?? a), res = j.data.resourceInfoMap?.[id];
				if (res) db.items[id] = [`🎁 ${tr(res.name)} x${res.count}`, res.icon || ""];
				return id;
			}))] : (db.accounts[acc] || []);
			if (j.code === 0) { db.accounts[acc] = ids; store.setProperty(key, JSON.stringify(db)); }
			out.msg = ids.length ? ids.map(id => db.items[id]?.[0]).join("\n") : "🎁 Successfully claimed";
			out.itemIcon_url = ids.map(id => db.items[id]?.[1]).filter(Boolean);
		} else {
			out.status = `❌ Error (Code: ${j.code})`; out.msg = j.message || "Unknown Error";
		}
	}
	console.log(`[${out.nickname} (${out.serverName})]\n🆔 ${out.uid}\n${out.status}\n${out.msg}${typeof buildPlayerCard !== 'undefined' ? buildPlayerCard(p) : ""}`);
	return out;
}

function discordPost(rows, colCount = Settings.discordColumn || 2, useEdit = Settings.discordUseEdit || false) {
	const store = PropertiesService.getScriptProperties(), key = "discord_db";
	const hooks = discordApp.filter(o => o.notify && o.discordWebhook);
	const k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join("");
	
	let db = JSON.parse(store.getProperty(key) || '{"date":"","msgMap":{}}');
	const cr = checkDailyReset(db.date, Settings.discordResetTime || "00:00:00");
	if (!useEdit || (useEdit && Settings.discordDailyPost && cr.isReset)) db = { date: cr.date, msgMap: {} };
	if (!db.msgMap) db.msgMap = {};

	const getReset = (type, opt, extra) => {
		const n = new Date(), o = type == 'cycle' ? extra : opt;
		const [a, rt = "00:00:00"] = Array.isArray(o) ? (type == 'daily' ? [0, o[0]] : o) : [o?.wd ?? o?.cyc ?? 0, o?.rt ?? o];
		const t = new Date(n); t.setHours(...rt.split(':'), 0);
		if (type != 'cycle') {
			const d = type == 'weekly' ? (a - n.getDay() + 7) % 7 : 0;
			t.setDate(t.getDate() + d + (!d && t <= n ? (type == 'weekly' ? 7 : 1) : 0));
			return Math.floor(t / 1000);
		}
		const b = new Date(opt.replace(" ", "T")), cyc = a * 864e5; b.setHours(...rt.split(':'), 0);
		return Math.floor((+b + Math.ceil((n - b + 1) / cyc) * cyc) / 1000);
	};

	let maxP = Settings.discordProfilesPerPost || 6, rowChunks = [];
	for (let i = 0; i < rows.length; i += maxP) rowChunks.push(rows.slice(i, i + maxP));

	hooks.forEach(h => {
		const hash = k(h.discordWebhook);
		let savedMap = db.msgMap[hash];
		let msgIds = Array.isArray(savedMap) ? savedMap : (savedMap ? [savedMap] : []);
		let newMsgIds = [];

		rowChunks.forEach((chunk, idx) => {
			const embed = {
				title: `📝 Endfield - Report${rowChunks.length > 1 ? ` (${idx + 1}/${rowChunks.length})` : ""} [<t:${nowTs()}:d>]`,
				color: chunk.every(r => r.success) ? [0xFF0000, 0xFFFF00, 0xFF69B4, 0x00A86B, 0xFFA500, 0x00BFFF, 0x800080][new Date().getDay()] : 0x2F3136,
				thumbnail: { url: "https://static.skport.com/image/common/20260122/a2ab8d4de53aabd3b1c305cbdbcab688.png" },
				fields: [
					{ name: "**Useful Link**", value: "[App](https://script.google.com/home/my) | [Home](https://endfield.gryphline.com/) | [Sched](https://endfield.gryphline.com/en-us#calendar) | [SKP](https://www.skport.com/) | [Wiki](https://wiki.skport.com/endfield) | [Guide](https://www.prydwen.gg/arknights-endfield/) | [Map](https://opendfieldmap.org/) | [BP#1](https://endfieldtools.dev/community-factories/) | [BP#2](https://talospioneers.com) | [Ess](https://endfieldtools.dev/weapon-essence-solver/)", inline: false },
					{ name: "**Server Reset**", value: `🌸 Daily: <t:${getReset('daily', Settings.serverDailyReset)}:R>\n🛒 Arsenal: <t:${getReset('weekly', Settings.serverArsenalReset)}:R>\n⚔️ EoW: <t:${getReset('weekly', Settings.serverEowReset)}:R>`, inline: true },
					{ name: `\u200B`, value: `📅 Weekly: <t:${getReset('weekly', Settings.serverWeelyReset)}:R>\n🌟 BP: <t:${getReset('cycle', Settings.serverBPCycleStart, Settings.serverBPCycleEnd)}:R>`, inline: true },
					{ name: "", value: "", inline: false },
					...chunk.flatMap((r, i) => [{
						name: `👤 **${r.nickname} (${r.serverName})**\n🆔 \`${r.uid}\``,
						value: `**Status:**\n\u2003${r.status}\n**Response:**\n\u2003${r.msg.replace(/\n/g, '\n\u2003')}${buildPlayerCard(r, true).replace(/\n/g, '\n\u2003')}`,
						inline: true
					}, ...((i + 1) % colCount === 0 && i + 1 < chunk.length ? [{ name: "", value: "", inline: false }] : [])])
				],
				footer: { text: "Updated on", icon_url: "https://assets.skport.com/assets/favicon.ico" },
				timestamp: new Date().toISOString()
			};

			const existingId = msgIds[idx];
			const canEdit = useEdit && !!existingId;
			const url = canEdit ? `${h.discordWebhook}/messages/${existingId}` : `${h.discordWebhook}?wait=true`;
			const method = canEdit ? "PATCH" : "POST";
			const payload = JSON.stringify({ username: "Endfield Assistant", avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png", embeds: [embed] });

			try {
				let res = chunkedFetchAll([{ url, method, payload, contentType: "application/json", muteHttpExceptions: true }])[0];
				let m = readMeta(res);
				if (m.code >= 200 && m.code < 300) {
					newMsgIds.push(canEdit ? existingId : (m.json?.id || existingId));
				} else if (canEdit) {
					let pr = chunkedFetchAll([{ url: `${h.discordWebhook}?wait=true`, method: "POST", payload, contentType: "application/json", muteHttpExceptions: true }])[0];
					let pm = readMeta(pr);
					if (pm.code >= 200 && pm.code < 300 && pm.json?.id) {
						newMsgIds.push(pm.json.id);
					} else {
						newMsgIds.push(existingId);
					}
				} else if (existingId) {
					newMsgIds.push(existingId);
				}
			} catch (e) {
				console.error(`Discord Error: ${e.message}`);
				if (existingId) newMsgIds.push(existingId);
			}
		});
		if (newMsgIds.length) db.msgMap[hash] = newMsgIds;
	});
	store.setProperty(key, JSON.stringify(db));
}

function handleErrorAlerts(rows) {
	const store = PropertiesService.getScriptProperties(), key = "discord_error_db";
	const k = u => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, u).map(b => (b + 256).toString(16).slice(-2)).join("");
	let db = JSON.parse(store.getProperty(key) || '{"msgMap":{}}');
	if (!db.msgMap) db.msgMap = {};
	let errors = rows.filter(r => !r.success);

	discordApp.forEach(app => {
		if (!app.notify || !app.myDiscordID || !app.discordWebhook) return;
		let target = app.dmWebhook || app.discordWebhook;
		let hash = k(target);
		let existingId = db.msgMap[hash] || "";
		
		if (errors.length) {
			let canEdit = !!existingId;
			let url = canEdit ? `${target}/messages/${existingId}` : `${target}?wait=true`;
			let method = canEdit ? "PATCH" : "POST";
			
			let payload = JSON.stringify({
				username: "Endfield Assistant",
				avatar_url: "https://static.skport.com/image/common/20260403/f266b2fc7ac711dc39f89929ba254681.png",
				content: `<@${app.myDiscordID}> ⚠️ **Found an error in the game account. Please check and fix it urgently.!**`,
				embeds: [{
					title: "🚨 Endfield - Account Error Report",
					color: 0xFF0000,
					fields: errors.map(e => ({ name: `👤 **${e.nickname} (${e.serverName})**`, value: `**Status:** ${e.status}\n**Details:** ${e.msg}`, inline: false })),
					footer: { text: "Updated on", icon_url: "https://assets.skport.com/assets/favicon.ico" },
					timestamp: new Date().toISOString()
				}]
			});
			
			try {
				let res = chunkedFetchAll([{ url, method, payload, contentType: "application/json", muteHttpExceptions: true }])[0];
				let m = readMeta(res);
				if (m.code < 300) {
					db.msgMap[hash] = m.json?.id || existingId;
				} else if (canEdit) {
					let newRes = chunkedFetchAll([{ url: `${target}?wait=true`, method: "POST", payload, contentType: "application/json", muteHttpExceptions: true }])[0];
					let newM = readMeta(newRes);
					if (newM.code < 300 && newM.json?.id) db.msgMap[hash] = newM.json.id;
				}
			} catch (e) { console.error(`Error Alert Failed: ${e.message}`); }
		} else if (existingId) {
			try {
				chunkedFetchAll([{ url: `${target}/messages/${existingId}`, method: "DELETE", muteHttpExceptions: true }]);
				delete db.msgMap[hash];
			} catch (e) { console.error(`Delete Error Msg Failed: ${e.message}`); }
		}
	});
	store.setProperty(key, JSON.stringify(db));
}

const buildPlayerCard = (p, b = false) => {
	if (!p?.playerCard || !p?.skGameRole) return "";
	let s = PropertiesService.getScriptProperties(), rKey = p.skGameRole, now = Date.now(), rgt = 432e3, bt = false, ema = false, key = "card_db";
	let { base: bs = {}, domain: dl = [], dungeon: dg = {}, bpSystem: bp = {}, dailyMission: dm = {}, weeklyMission: wm = {} } = p.playerCard;
	let en = +dg.curStamina || 0, em = +dg.maxStamina || 0, dc = Settings.discordColumn === 1;
	let db = JSON.parse(s.getProperty(key) || "{}"), acc = db[rKey] || { updatedAt: now, sta: { curStamina: en, maxTs: +dg.maxTs || now }, aic: [] };
	let oldUpd = acc.updatedAt || now; acc.updatedAt = now, baseTs = (+en >= (acc?.sta?.curStamina ?? -1) ? acc?.sta?.maxTs : null) || +dg.maxTs || now;
	let savedTs = baseTs > 1e11 ? baseTs : baseTs * 1e3; if (bt) savedTs = Math.floor(savedTs / 36e5) * 36e5 + Math.floor((savedTs % 36e5) / rgt) * rgt;
	if (dg.maxTs !== undefined) dg.maxTs = savedTs; acc.sta = { curStamina: en, maxTs: savedTs };
	let wrap = t => b ? `\`${t}\`` : t, tr = n => typeof DomainLib !== 'undefined' ? (DomainLib?.translate?.(n) || n) : n;
	let fmt = ts => {
		if (!ts) return "-";
		let sec = (ts > 1e11 ? ts / 1e3 : ts) | 0;
		if (b) return `<t:${sec}:R>`;
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
			let sIdx = vIdx++, isFull = +x.remainMoney >= +x.moneyMax, sum = +x.remainMoney, max = +x.moneyMax;
			let old = domAic[sIdx] || {}, rate = old.rate || 0, maxTs = old.maxTs || null;
			if (!isFull) {
				let diff = sum - (old.curMoney || 0);
				if (mins >= 1 && diff > 0) {
					let calc = diff / mins; rate = ema && rate > 0 ? (calc > rate + 3 ? rate + 1.2 : rate - 0.7 + calc * 0.3) : calc;
				} else if (diff < 0) { rate = 0; }
				maxTs = (rate > 0 && max - sum > 0) ? Math.floor(now + ((max - sum) / rate) * 6e4) : null;
				domAic[sIdx] = { curMoney: sum, rate, maxTs };
			} else {
				rate = 0; maxTs = null;
				domAic[sIdx] = { curMoney: sum, rate: 0, maxTs: null };
			}
			return { ...x, rate: isFull ? 0 : rate, maxTs: isFull ? null : maxTs };
		});
		let sList = d.settlements.filter(x => +x.level > 0);
		let cur = sList.reduce((a, x) => a + +x.remainMoney, 0), max = sList.reduce((a, x) => a + +x.moneyMax, 0), fd = sList.filter(x => +x.remainMoney === +x.moneyMax).length;
		let rList = sList.map((x, i) => {
			let isFull = +x.remainMoney >= +x.moneyMax, pct = ((+x.remainMoney / +x.moneyMax) * 100).toFixed(2) + "%";
			let status = isFull ? wrap("Fulled") : (x.maxTs ? `+${shn(x.rate)}/m, ~${fmt(x.maxTs)}` : pct);
			let remStr = `${shn(x.remainMoney)}/${shn(x.moneyMax)}`;
			return dc ? `\u2003\u2003[${i + 1}]: ${tr(x.name)}\n\u2003\u2003\u2003— ${remStr} | ${status}` : `\u2003\u2003[${i + 1}]: ${remStr}`;
		}).join("\n");
		aSum += cur; aMax += max;
		let tName = tr(d.name), dName = dc ? tName : tName.trim().split(/\s+/)[0];
		let dStatus = (sList.length && fd === sList.length) ? wrap("Fulled") : (max ? ((cur / max) * 100).toFixed(2) : "0.00") + "%";
		aStr += `\n\u2003→ ${dName} [${fd}/${sList.length}]: ${dStatus}${rList ? "\n" + rList : ""}`;
	});
	db[rKey] = acc; s.setProperty(key, JSON.stringify(db));
	let eStr = cap => en >= cap ? wrap("Fulled") : fmt(savedTs + (cap - em) * rgt);
	return `\n🔑 Login: ${fmt(bs.lastLoginTime * 1e3)}\n🌸 Daily: ${dm.dailyActivation ?? 0}/${dm.maxDailyActivation ?? 0}\n📅 Weekly: ${wm.score ?? 0}/${wm.total ?? 0}\n🌟 BP: ${bp.curLevel ?? 0}/${bp.maxLevel ?? 0}\n⚡️ Energy: ${en}/${em}\n${[160, 200, 240, em].map(v => `\u2003→ ${v}: ${eStr(v)}`).join("\n")}\n🏠 AIC Funds: ${aMax ? ((aSum / aMax) * 100).toFixed(2) : "0.00"}%${aStr}`;
};

function doGet(e) {
	return HtmlService.createHtmlOutputFromFile('Index').setTitle('Endfield - Dashboard').addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getWebData() {
	let s = PropertiesService.getScriptProperties(), m = JSON.parse(s.getProperty('web_meta') || 'null');
	return m ? JSON.parse(Array.from({length: m.chunks}, (_, i) => s.getProperty('web_chunk_' + i)).join('')) : { updatedAt: Date.now(), accounts: [] };
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
	let s = PropertiesService.getScriptProperties(), u = Date.now();
	let tr = n => (typeof DomainLib !== 'undefined' && DomainLib?.translate?.(n)) || n;
	let d = JSON.stringify({
		updatedAt: u, serverReset: getNextResetTimestamps(Settings), tz: Session.getTimeZone(),
		accounts: res.map(p => {
			let cp = p.playerCard;
			return {
				nickname: p.nickname, uid: p.uid, serverName: p.serverName, success: p.success, status: p.status, msg: p.msg, itemIcon_url: p.itemIcon_url, skGameRole: p.skGameRole,
				playerCard: cp?.base ? {
					base: { lastLoginTime: cp.base.lastLoginTime, avatarUrl: cp.base.avatarUrl },
					dungeon: { curStamina: cp.dungeon.curStamina, maxStamina: cp.dungeon.maxStamina, maxTs: cp.dungeon.maxTs },
					bpSystem: { curLevel: cp.bpSystem.curLevel, maxLevel: cp.bpSystem.maxLevel },
					dailyMission: { dailyActivation: cp.dailyMission.dailyActivation, maxDailyActivation: cp.dailyMission.maxDailyActivation },
					weeklyMission: { score: cp.weeklyMission.score, total: cp.weeklyMission.total },
					domain: (cp.domain || []).map(dom => ({
						name: tr(dom.name),
						settlements: (dom.settlements || []).filter(x => +x.level > 0).map(({ level, name, remainMoney, moneyMax, rate, maxTs }) => ({
							level, name: tr(name), remainMoney, moneyMax, rate: rate || 0, maxTs: maxTs || null
						}))
					}))
				} : null
			};
		})
	});
	let c = Math.ceil(d.length / 8000);
	s.getKeys().forEach(k => (k.startsWith('web_chunk_') || k === 'web_meta' || k === 'web_display_data') && s.deleteProperty(k));
	s.setProperty('web_meta', JSON.stringify({ chunks: c, updatedAt: u }));
	for (let i = 0; i < c; i++) s.setProperty('web_chunk_' + i, d.substring(i * 8000, (i + 1) * 8000));
}

function getSkipReason(r) {
	if (!r) return null;
	let c = Number(r.getResponseCode()), t = r.getContentText() || "", j = parseJson(t);
	if (j && j.code !== undefined) return isSuccess(j.code) ? null : Settings.skipCodes[j.code];
	return /<!doctype|<html|Cloudflare/i.test(t) ? Settings.skipError["HTML"] : Settings.skipError[c] || null;
}
const isSuccess = code => typeof Settings.successCodes[code] !== 'undefined';
const isValidResp = r => { let m = readMeta(r); return (m?.json && isSuccess(m.json.code)) || getSkipReason(r) !== null; };
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

function chunkedFetchAll(reqs, isValid = r => r.getResponseCode() >= 200 && r.getResponseCode() < 300) {
	const { chunkSize: sz = 20, retry: { max = 5, initialBackoffMs: bf = 500, maxBackoffMs: mBf = 5000 } = {} } = Settings;
	const err = m => ({ getContentText: () => JSON.stringify({ error: m }), getResponseCode: () => 0 });
	return Array.from({ length: Math.ceil(reqs.length / sz) }, (_, i) => reqs.slice(i * sz, (i + 1) * sz)).flatMap(chk => {
		let res; try { res = UrlFetchApp.fetchAll(chk); } catch (e) { console.error(`Batch Error: ${e.message}`); res = chk.map(() => err(e.message)); }
		return res.map((r, j) => {
			for (let a = 0, rq = chk[j], code, txt, skip; a < max && !isValid(r); a++) {
				code = r.getResponseCode(); txt = r.getContentText() || "";
				if ((code !== 0 && code < 500) && (!txt.includes("Address unavailable") && !txt.includes("DNS")) && (skip = getSkipReason(r))) { console.error(`Skipped (${rq.url || "Req"}): ${skip}`); break; }
				const d = Math.min(bf * 2 ** a, mBf); console.warn(`[Retry ${a + 1}/${max}] ${rq.url || "Req"} (Status: ${code}) in ${d}ms`); Utilities.sleep(d);
				try { r = UrlFetchApp.fetch(rq.url, rq); } catch (e) { console.error(`Fetch Error: ${e.message}`); r = err(e.message); }
			}
			return r;
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
