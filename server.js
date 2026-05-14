const express = require("express");
const path = require("path");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 8,
  },
});

app.use(express.json({ limit: "15mb" }));
app.use(express.static(__dirname));

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing in Railway Variables.");
  }
}

async function callOpenAI(input, instructions = "") {
  requireApiKey();

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      instructions,
      input,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI error:", data);
    throw new Error(data?.error?.message || "OpenAI request failed.");
  }

  return data.output_text || data.output?.[0]?.content?.[0]?.text || "";
}

async function callOpenAIVisionForFile(file) {
  requireApiKey();

  const base64 = file.buffer.toString("base64");
  const mimeType = file.mimetype || "application/octet-stream";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const isPdf =
    mimeType.includes("pdf") ||
    (file.originalname || "").toLowerCase().endsWith(".pdf");

  const fileContent = isPdf
    ? {
        type: "input_file",
        filename: file.originalname || "uploaded.pdf",
        file_data: dataUrl,
      }
    : {
        type: "input_image",
        image_url: dataUrl,
      };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract all readable text from this document, scanned certificate, or image. Preserve names, dates, course codes, unit names, providers, results, issue dates and statement numbers. Return plain text only.",
            },
            fileContent,
          ],
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI file/vision error:", data);
    throw new Error(data?.error?.message || "OpenAI file extraction failed.");
  }

  return data.output_text || data.output?.[0]?.content?.[0]?.text || "";
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function looksTooShort(text) {
  return !text || String(text).trim().length < 80;
}

app.post("/api/classify", async (req, res) => {
  try {
    const { industry_unit_text, asked_clarify, clarify_answer } = req.body;

    const text = await callOpenAI(
      JSON.stringify({ industry_unit_text, asked_clarify, clarify_answer }),
      `
You classify trainer currency evidence into one of these JSON decisions only.

Return valid JSON only.

Decision rules:
- block_1_2 = high-risk work environments such as working at heights, confined spaces, mining, rooftops, scaffolds, tanks, tunnels, EWP, rescue, construction high risk.
- block_1_1 = general workplace/industry currency.
- clarify = only when genuinely unsure.

JSON shape:
{
  "decision": "block_1_1" | "block_1_2" | "clarify",
  "clarify_question": ""
}
`
    );

    res.json(
      safeJsonParse(text, {
        decision: "clarify",
        clarify_question:
          "Can you confirm whether this involves high-risk environments such as working at heights, confined spaces, mining, rooftops, scaffolds, tanks, tunnels, or EWPs?",
      })
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Routing failed." });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const payload = req.body;

    const output = await callOpenAI(
      JSON.stringify(payload),
      `
You write trainer currency statements for Allens Training.

Write in first person as the trainer.
Use only information provided.
Do not invent evidence, employers, dates, courses, qualifications, incidents, or memberships.
Do not mention missing fields.
Do not write "not provided".
Keep it professional, specific, and suitable for a trainer profile currency note.
Focus on currency within the past 12 months.
`
    );

    res.json({
      output_text: output,
      blocked: false,
      warnings: [],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Generation failed." });
  }
});

app.post("/api/score", async (req, res) => {
  try {
    const payload = req.body;

    const text = await callOpenAI(
      JSON.stringify(payload),
      `
Score this trainer currency statement from 0 to 100.

Return valid JSON only:
{
  "overall_score": 0,
  "feedback": ["short practical feedback item"]
}

Score based on:
- relevance to course/unit
- evidence of recent workplace currency
- specificity
- clarity
- no unsupported claims
`
    );

    res.json(
      safeJsonParse(text, {
        overall_score: 0,
        feedback: ["Currency Check could not parse the AI response."],
      })
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Currency Check failed." });
  }
});

app.post("/api/parse-uploads", upload.array("files"), async (req, res) => {
  try {
    const files = req.files || [];
    const mode = req.body?.mode || "evidence";

    if (!files.length) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    const extractedParts = [];

    for (const file of files) {
      const name = file.originalname || "uploaded file";
      const type = file.mimetype || "";
      const lowerName = name.toLowerCase();

      let text = "";

      if (type.includes("text") || lowerName.endsWith(".txt")) {
        text = file.buffer.toString("utf8");
      } else if (type.includes("pdf") || lowerName.endsWith(".pdf")) {
        try {
          const parsed = await pdfParse(file.buffer);
          text = parsed.text || "";
        } catch {
          text = "";
        }

        if (looksTooShort(text)) {
          text = await callOpenAIVisionForFile(file);
        }
      } else if (
        type.includes("wordprocessingml") ||
        lowerName.endsWith(".docx")
      ) {
        const parsed = await mammoth.extractRawText({ buffer: file.buffer });
        text = parsed.value || "";
      } else if (
        type.startsWith("image/") ||
        lowerName.endsWith(".png") ||
        lowerName.endsWith(".jpg") ||
        lowerName.endsWith(".jpeg") ||
        lowerName.endsWith(".webp")
      ) {
        text = await callOpenAIVisionForFile(file);
      } else {
        extractedParts.push(
          `FILE: ${name}\nUnsupported file type. Upload TXT, PDF, DOCX, PNG, JPG, JPEG, or WEBP.`
        );
        continue;
      }

      extractedParts.push(`FILE: ${name}\n${String(text || "").trim()}`);
    }

    const evidenceText = extractedParts.join("\n\n").trim();

    let parsedResume = null;

    if (mode === "resume" && evidenceText) {
      const parsedText = await callOpenAI(
        evidenceText,
        `
Extract resume/CV information as valid JSON only.

Return:
{
  "employment": [
    {
      "company": "",
      "job_title": "",
      "start_date": "",
      "end_date": "",
      "responsibilities": []
    }
  ]
}

Use only information in the resume.
If unsure, leave fields blank.
`
      );

      parsedResume = safeJsonParse(parsedText, null);
    }

    res.json({
      evidence_text: evidenceText,
      parsed: parsedResume,
      characters: evidenceText.length,
      files_processed: files.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || "Upload parsing failed.",
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
