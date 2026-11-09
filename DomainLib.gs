const DomainLib = (() => {
	let useTranslate = true, lang = "th";
	const dict = {
		"th": {
			"Valley IV": "หุบเขา IV",
			"Refugee Camp": "ค่ายผู้ลี้ภัย",
			"Infra-Station": "สถานีอินฟรา",
			"Reconstruction HQ": "การสร้างสำนักงานใหญ่ขึ้นมาใหม่",
			"Wuling": "อู่หลิง",
			"Sky King Flats Construction Site": "พื้นที่ก่อสร้างที่ราบราชันแห่งท้องฟ้า",
			"Cardiac Remediation Station": "สถานีฟื้นฟูหัวใจ",
			"Xiranflow Cloudseeder Station": "สถานีโปรยเมฆซีเรนโฟลว์",
		}
	};

	return {
		translate: (name, targetLang) => {
			if (!name) return "";
			let key = name.trim();
			if (!useTranslate) return key;
			return dict[targetLang || lang]?.[key] || key;
		},
		getConfig: () => ({ useTranslate, lang }),
		setConfig: (cfg) => {
			if (cfg.useTranslate !== undefined) useTranslate = !!cfg.useTranslate;
			if (cfg.lang !== undefined) lang = cfg.lang;
		},
		getDict: () => dict
	};
})();
