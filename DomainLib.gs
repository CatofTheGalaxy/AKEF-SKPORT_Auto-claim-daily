const DomainLib = (() => {
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
		translate: (name, lang = "th") => {
			if (!name) return "";
			let key = name.trim();
			return dict[lang]?.[key] || name;
		},
		getDict: () => dict
	};
})();
