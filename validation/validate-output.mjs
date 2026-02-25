import fs from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

function extractSections(text) {
	// (A)(B)(C) をざっくり切り出し（Cは任意）
	const aIdx = text.indexOf("(A)");
	const bIdx = text.indexOf("(B)");
	const cIdx = text.indexOf("(C)");

	if (aIdx === -1 || bIdx === -1) {
		throw new Error("Missing required sections: (A) and/or (B).");
	}

	const A = text.slice(aIdx, bIdx).trim();
	const B = cIdx === -1 ? text.slice(bIdx).trim() : text.slice(bIdx, cIdx).trim();
	const C = cIdx === -1 ? "" : text.slice(cIdx).trim();

	return {
		A, B, C
	};
}

function extractJavaCode(sectionB) {
	const m = sectionB.match(/```java\s*([\s\S]*?)\s*```/m);
	if (!m) throw new Error("Missing ```java code block in (B).");
	const code = m[1];

	const testCount = (code.match(/@Test\b/g) || []).length;
	return {
		code, testCount
	};
}

function parseTestCases(sectionA) {
	// 1ケースを「テストケースID: TC-XXX」から次のID直前まで、で分割
	const chunks = sectionA.split(/(?=テストケースID:\s*TC-\d{3})/g).map(s => s.trim()).filter(
		Boolean);

	const cases = [];
	for (const ch of chunks) {
		const id = (ch.match(/テストケースID:\s*(TC-\d{3})/) || [])[1];
		if (!id) continue;

		const category = (ch.match(/カテゴリ:\s*\[(正常系|異常系|境界値|セキュリティ)\]/) || [])[1];
		const priority = (ch.match(/優先度:\s*\[(高|中|低)\]/) || [])[1];

		const preconditions = (ch.match(/前提条件:\s*([\s\S]*?)\nテスト手順:/) || [])[1] ? .trim();
		const stepsRaw = (ch.match(/テスト手順:\s*([\s\S]*?)\n期待結果:/) || [])[1] ? .trim();
		const expected = (ch.match(/期待結果:\s*([\s\S]*?)\n実装根拠:/) || [])[1] ? .trim();
		const evidence = (ch.match(/実装根拠:\s*([\s\S]*)$/) || [])[1] ? .trim();

		const steps = (stepsRaw || "")
			.split(/\n\d+\.\s*/g)
			.map(s => s.trim())
			.filter(Boolean);

		cases.push({
			id,
			category,
			priority,
			preconditions: preconditions || "",
				steps,
				expected: expected || "",
				evidence: evidence || ""
		});
	}
	return cases;
}

function ruleChecks(parsed) {
	// (1) 15件以上（あなたのプロンプト必須条件） :contentReference[oaicite:3]{index=3}
	if (parsed.cases.length < 15) {
		throw new Error(
			`Test case count too low: ${parsed.cases.length} (expected >= 15)`);
	}

	// (2) 各カテゴリ最低3件（あなたのプロンプト必須条件） :contentReference[oaicite:4]{index=4}
	const countByCat = parsed.cases.reduce((m, c) => {
		m[c.category] = (m[c.category] || 0) + 1;
		return m;
	}, {});
	for (const cat of["正常系", "異常系", "境界値", "セキュリティ"]) {
		if ((countByCat[cat] || 0) < 3) {
			throw new Error(
				`Category "${cat}" too few: ${countByCat[cat] || 0} (expected >= 3)`);
		}
	}

	// (3) TC-ID重複禁止
	const ids = parsed.cases.map(c => c.id);
	const dup = ids.find((v, i) => ids.indexOf(v) !== i);
	if (dup) throw new Error(`Duplicate test case id found: ${dup}`);

	// (4) JUnit/Selenium必須要素（Promptfooでも見てる観点） :contentReference[oaicite:5]{index=5}
	const code = parsed.java.code;
	const requiredSnippets = [
		"org.junit.jupiter", "WebDriver", "WebDriverWait", "@BeforeEach",
		"@AfterEach", "@Test"
	];
	const missing = requiredSnippets.filter(s => !code.includes(s));
	if (missing.length) throw new Error(
		`Missing required Java snippets: ${missing.join(", ")}`);

	// (5) @Test最低3つ（Promptfooでも見てる観点） :contentReference[oaicite:6]{index=6}
	if (parsed.java.testCount < 3) {
		throw new Error(
			`Too few @Test methods: ${parsed.java.testCount} (expected >= 3)`);
	}
}

function main() {
	const inputPath = process.argv[2];
	if (!inputPath) {
		console.error("Usage: node validate-output.mjs <llm-output.txt>");
		process.exit(2);
	}

	const text = fs.readFileSync(inputPath, "utf8");

	const sections = extractSections(text);
	const java = extractJavaCode(sections.B);
	const cases = parseTestCases(sections.A);

	const parsed = {
		sections, java, cases
	};

	// JSON Schema validation
	const schema = JSON.parse(fs.readFileSync("schema.json", "utf8"));
	const ajv = new Ajv({
		allErrors: true,
		strict: true
	});
	addFormats(ajv);
	const validate = ajv.compile(schema);
	const ok = validate(parsed);
	if (!ok) {
		console.error("❌ Schema validation failed:");
		for (const err of validate.errors ? ? []) {
			console.error(`- ${err.instancePath || "(root)"} ${err.message}`);
		}
		process.exit(1);
	}

	// Additional rule checks
	try {
		ruleChecks(parsed);
	} catch (e) {
		console.error("❌ Rule check failed:", e.message);
		process.exit(1);
	}

	console.log("✅ Output structure & rules validated OK.");
}

main();
