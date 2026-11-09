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
		translate: (n, t) => !n ? "" : (useTranslate ? (dict[t || lang]?.[n.trim()] || n.trim()) : n.trim()),
		getConfig: () => ({ useTranslate, lang }),
		setConfig: ({ useTranslate: u, lang: l }) => {
			u !== undefined && (useTranslate = !!u);
			l !== undefined && (lang = l);
		},
		getDict: () => dict
	};
})();
