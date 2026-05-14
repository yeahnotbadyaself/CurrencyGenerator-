const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "10mb" }));
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

    res.json(JSON.parse(text));
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

    res.json(JSON.parse(text));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Currency Check failed." });
  }
});

app.post("/api/parse-uploads", async (req, res) => {
  res.status(501).json({
    error:
      "File upload parsing is not connected yet. Generate can still work from typed answers.",
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
