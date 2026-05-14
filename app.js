const el = (id) => document.getElementById(id);
const COPY_SUCCESS_MESSAGE =
  "Copied! Paste this into your Currency Notes in your Trainer Profile. Your submission will then be reviewed by our team. We'll contact you if any further information is required.";

let toastTimer = null;

const state = {
  routing: null,
  askedClarify: false,

  // extracted text
  resumeText: "",
  industryEvidenceText: "",

  // structured resume
  resumeParsed: null,

  // health followup
  healthFollowup: { workplace: "", start_date: "" },
};

function show(id, on = true) { el(id)?.classList.toggle("hidden", !on); }
function setText(id, t) { const n = el(id); if (n) n.textContent = t; }

function clearMessages() {
  show("errorBox", false);
  show("successBox", false);
  setText("errorBox", "");
  setText("successBox", "");
}

function showError(msg) {
  setText("errorBox", msg);
  show("errorBox", true);
  show("successBox", false);
}

function showSuccess(msg) {
  setText("successBox", msg);
  show("successBox", true);
  show("errorBox", false);
}

function showPopupNotification(msg, type = "success") {
  const toast = el("toast");
  if (!toast) return;

  toast.textContent = msg;
  toast.className = `toast ${type === "error" ? "toast-error" : "toast-success"}`;
  show("toast", true);

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show("toast", false), 8500);
}

function hidePopupNotification() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  show("toast", false);
}

function resetScoreUI() {
  show("scoreCard", false);
  setText("scoreResult", "");
  const scoreBtn = el("scoreBtn");
  if (scoreBtn) scoreBtn.disabled = true;
}

function setButtonsAfterGenerate({ enableCopy, enableScore }) {
  const copyBtn = el("copyBtn");
  const scoreBtn = el("scoreBtn");
  if (copyBtn) copyBtn.disabled = !enableCopy;
  if (scoreBtn) scoreBtn.disabled = !enableScore;
}

function scrubOutputText(t) {
  if (!t) return "";
  const lines = String(t).split(/\r?\n/);

  const filtered = lines.filter((l) => {
    const s = l.trim();
    if (!s) return true;
    if (/^no additional\b/i.test(s)) return false;
    if (/\bwere provided\b/i.test(s) && /\binputs?\b/i.test(s)) return false;
    if (/\bnot provided\b/i.test(s)) return false;
    if (/\bno further\b/i.test(s)) return false;
    if (/\bno (?:additional|other)\b/i.test(s) && /\bprovided\b/i.test(s)) return false;
    return true;
  });

  return filtered.join("\n").trim();
}

/* =========================
   File name UI helper
========================= */
function attachFileName(inputId, labelId) {
  const input = el(inputId);
  const label = el(labelId);
  if (!input || !label) return;

  const render = () => {
    const files = Array.from(input.files || []);
    if (files.length === 0) { label.textContent = ""; return; }
    label.textContent = files.length === 1
      ? files[0].name
      : `${files[0].name} (+${files.length - 1} more)`;
  };

  input.addEventListener("change", render);
  render();
}

/* =========================
   Upload + extract
========================= */
async function parseUploadsFromInput(fileInputId, summaryId, textKey) {
  clearMessages();

  const input = el(fileInputId);
  const files = input?.files;

  if (!files || files.length === 0) {
    setText(summaryId, "");
    return;
  }

  const fd = new FormData();
  for (const f of files) fd.append("files", f);

  setText(summaryId, "Uploading and extracting text...");

  if (textKey === "resumeText") fd.append("mode", "resume");

  // Backend can auto-detect resumes, but this field keeps the contract explicit.
  const res = await fetch("/api/parse-uploads", { method: "POST", body: fd });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setText(summaryId, "");
    const msg = err?.error || "Upload failed.";
    showPopupNotification(msg, "error");
    return showError(msg);
  }

  const data = await res.json();

  // Save extracted text
  state[textKey] = data.evidence_text || "";

  // Save structured resume if present
  if (textKey === "resumeText") {
    state.resumeParsed = data.parsed || null;
  }

  setText(
    summaryId,
    `Uploaded successfully. Extracted ${data.characters || 0} characters from ${data.files_processed || 0} file(s).`
  );

  showSuccess("Upload successful.");

  // If we already routed, try prefilling immediately (without overwriting user input)
  if (state.routing?.decision === "block_1_1" && textKey === "resumeText") {
    prefillEmploymentFromResume();
  }
  if (state.routing?.decision === "block_1_2" && textKey === "resumeText") {
    prefillHighRiskFromResume();
  }
  if (state.routing?.decision === "block_1_1" && textKey === "industryEvidenceText") {
    prefillMaintainSkillsFromEvidence();
  }
}

/* =========================
   Routing
========================= */
async function route() {
  clearMessages();

  const industryUnitText = (el("industryUnitText")?.value || "").trim();
  if (!industryUnitText) return showError("Please enter industry / unit / course text to continue.");

  show("routingCard", true);
  setText("routingStatus", "Determining the correct block...");

  const res = await fetch("/api/classify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    industry_unit_text: industryUnitText,
    asked_clarify: state.askedClarify,
    clarify_answer: (el("clarifyAnswer")?.value || "").trim(),
  }),
});

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setText("routingStatus", "");
    return showError(err?.error || "Routing failed.");
  }

  const data = await res.json();

  // Clarify flow
  if (data && data.decision === "clarify") {
    state.askedClarify = true;
    state.routing = data;

    const clarifyQuestion =
      data.clarify_question ||
      data.question ||
      "To make sure the correct information is captured, does this involve work in high-risk environments such as confined spaces, working at heights, mining, tanks, tunnels, rooftops, scaffolds or EWPs?";

    setText("routingStatus", "We need one quick clarification.");
    setText("clarifyQuestion", clarifyQuestion);
    if (el("clarifyAnswer")) el("clarifyAnswer").value = "";
    show("clarifyWrap", true);

    // Disable generate until resolved
    if (el("generateBtn")) el("generateBtn").disabled = true;
    if (el("regenBtn")) el("regenBtn").disabled = true;
    return;
  }

  // Final decision
  state.routing = data;
  state.askedClarify = false;

  show("clarifyWrap", false);
  setText("routingStatus", `Selected: ${data.decision}`);

  if (data.decision === "block_1_1") {
    setText("blockTitle", "Block 1.1");
    setText("blockSubtitle", "General industry employment and currency evidence.");
    show("block11", true);
    show("block12", false);

    // Prefill if possible
    prefillEmploymentFromResume();
    prefillMaintainSkillsFromEvidence();

    if (el("generateBtn")) el("generateBtn").disabled = false;
    if (el("regenBtn")) el("regenBtn").disabled = true;
    showSuccess("Block 1.1 loaded.");
    return;
  }

  if (data.decision === "block_1_2") {
    setText("blockTitle", "Block 1.2");
    setText("blockSubtitle", "Additional high-risk employment detail required.");
    show("block11", false);
    show("block12", true);

    // Prefill if possible
    prefillHighRiskFromResume();

    if (el("generateBtn")) el("generateBtn").disabled = false;
    if (el("regenBtn")) el("regenBtn").disabled = true;
    showSuccess("Block 1.2 loaded.");
    return;
  }

  // If we got here, something unexpected
  return showError("Unexpected routing decision. Please try again.");
}

/* =========================
   Prefill helpers
========================= */
function bestRoleFromParsedResume(parsed) {
  if (!parsed) return null;

  const roles = [
    ...(Array.isArray(parsed.employment) ? parsed.employment : []),
    ...(Array.isArray(parsed.employment_history) ? parsed.employment_history : []),
  ];

  if (!roles.length) return null;

  // choose most recent role with some data
  const sorted = [...roles].sort((a, b) => {
    const ad = dateScoreForRole(a);
    const bd = dateScoreForRole(b);
    return bd - ad;
  });

  return sorted.find((r) => (r.company || r.employer || r.job_title || r.title)) || sorted[0];
}

function dateInputValue(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s || /\b(present|current)\b/i.test(s)) return "";

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const dd = String(dmy[1]).padStart(2, "0");
    const mm = String(dmy[2]).padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }

  const my = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) {
    const mm = String(my[1]).padStart(2, "0");
    return `${my[2]}-${mm}-01`;
  }

  const namedMonth = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{4})$/i);
  if (namedMonth) {
    const monthMap = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      sept: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const key = namedMonth[1].toLowerCase();
    return `${namedMonth[2]}-${monthMap[key]}-01`;
  }

  return "";
}

function dateScoreForRole(role) {
  if (/\b(present|current)\b/i.test(String(role?.end_date || ""))) return Number.MAX_SAFE_INTEGER;
  const inputDate = dateInputValue(role?.end_date || role?.start_date || "");
  return inputDate ? Date.parse(inputDate) || 0 : 0;
}

function prefillEmploymentFromResume() {
  if (!state.resumeParsed) return;

  const role = bestRoleFromParsedResume(state.resumeParsed);
  if (!role) return;

  // Only fill if empty
  const employerEl = el("curEmployer");
  const jobEl = el("curJobTitle");
  const startEl = el("curStart");
  const endEl = el("curEnd");
  const tasksEl = el("curTasks");

  if (employerEl && !(employerEl.value || "").trim()) employerEl.value = (role.company || role.employer || "").trim();
  if (jobEl && !(jobEl.value || "").trim()) jobEl.value = (role.job_title || role.title || "").trim();

  const startISO = dateInputValue(role.start_date);
  const endISO = dateInputValue(role.end_date);

  if (startEl && !(startEl.value || "").trim()) startEl.value = startISO;
  if (endEl && !(endEl.value || "").trim()) endEl.value = endISO;

  if (tasksEl && !(tasksEl.value || "").trim()) {
    const resp = Array.isArray(role.responsibilities)
      ? role.responsibilities.filter(Boolean).join(" ")
      : String(role.responsibilities || "").trim();
    tasksEl.value = resp;
  }
}

function prefillHighRiskFromResume() {
  if (!state.resumeParsed) return;

  const role = bestRoleFromParsedResume(state.resumeParsed);
  if (!role) return;

  const companyEl = el("hrCompany");
  const jobEl = el("hrJobTitle");
  const startEl = el("hrStart");
  const endEl = el("hrEnd");
  const tasksEl = el("hrTasks");

  if (companyEl && !(companyEl.value || "").trim()) companyEl.value = (role.company || role.employer || "").trim();
  if (jobEl && !(jobEl.value || "").trim()) jobEl.value = (role.job_title || role.title || "").trim();

  const startISO = dateInputValue(role.start_date);
  const endISO = dateInputValue(role.end_date);

  if (startEl && !(startEl.value || "").trim()) startEl.value = startISO;
  if (endEl && !(endEl.value || "").trim()) endEl.value = endISO;

  if (tasksEl && !(tasksEl.value || "").trim()) {
    const resp = Array.isArray(role.responsibilities)
      ? role.responsibilities.filter(Boolean).join(" ")
      : String(role.responsibilities || "").trim();
    tasksEl.value = resp;
  }
}

function prefillMaintainSkillsFromEvidence() {
  const maintainEl = el("maintainSkillsText");
  if (!maintainEl) return;
  if ((maintainEl.value || "").trim()) return;
  if (!state.industryEvidenceText) return;

  const text = String(state.industryEvidenceText || "").trim();
  maintainEl.value = text.slice(0, 8000);
}

/* =========================
   Repeatable rows
========================= */
function addHistoryRow(containerId) {
  const container = el(containerId);
  if (!container) return;

  const wrap = document.createElement("div");
  wrap.className = "card dynamic-row";
  wrap.innerHTML = `
    <div class="grid2">
      <label class="field"><span>Company/organisation</span><input type="text" data-k="employer"></label>
      <label class="field"><span>Job title</span><input type="text" data-k="job_title"></label>
      <label class="field"><span>Start date</span><input type="date" data-k="start_date"></label>
      <label class="field"><span>End date (if current, leave blank)</span><input type="date" data-k="end_date"></label>
    </div>
    <label class="field">
      <span>Responsibilities / tasks</span>
      <textarea rows="3" data-k="tasks" placeholder="Describe responsibilities relevant to the unit or course."></textarea>
    </label>
    <button class="ghost" type="button">Remove</button>
  `;

  wrap.querySelector("button")?.addEventListener("click", () => wrap.remove());
  container.appendChild(wrap);
}

function addPdRow(containerId) {
  const container = el(containerId);
  if (!container) return;

  const wrap = document.createElement("div");
  wrap.className = "card dynamic-row";
  wrap.innerHTML = `
    <div class="grid2">
      <label class="field"><span>Activity type</span><input type="text" data-k="activity_type"></label>
      <label class="field"><span>Title</span><input type="text" data-k="title"></label>
      <label class="field"><span>Provider</span><input type="text" data-k="provider"></label>
      <label class="field"><span>Date</span><input type="date" data-k="date"></label>
    </div>
    <label class="field"><span>Key learnings</span><textarea rows="2" data-k="key_learnings"></textarea></label>
    <button class="ghost" type="button">Remove</button>
  `;

  wrap.querySelector("button")?.addEventListener("click", () => wrap.remove());
  container.appendChild(wrap);
}

function addCertRow(containerId) {
  const container = el(containerId);
  if (!container) return;

  const wrap = document.createElement("div");
  wrap.className = "card dynamic-row";
  wrap.innerHTML = `
    <div class="grid2">
      <label class="field"><span>Course code</span><input type="text" data-k="course_code"></label>
      <label class="field"><span>Full name</span><input type="text" data-k="full_name"></label>
      <label class="field"><span>Issue / completion date</span><input type="date" data-k="issue_date"></label>
      <div></div>
    </div>
    <button class="ghost" type="button">Remove</button>
  `;

  wrap.querySelector("button")?.addEventListener("click", () => wrap.remove());
  container.appendChild(wrap);
}

function collectRows(containerId) {
  const container = el(containerId);
  if (!container) return [];

  const rows = [];
  container.querySelectorAll(".dynamic-row").forEach((row) => {
    const obj = {};
    row.querySelectorAll("[data-k]").forEach((input) => {
      const key = input.getAttribute("data-k");
      if (key) obj[key] = (input.value || "").trim();
    });
    if (Object.values(obj).some(Boolean)) rows.push(obj);
  });

  return rows;
}

function clearDynamicRows() {
  ["historyList", "historyList2", "pdList2", "certList2"].forEach((id) => {
    const container = el(id);
    if (container) container.innerHTML = "";
  });
}

/* =========================
   Structured prompt fields (prompts-first)
========================= */
function getTrainerStatusLabel() {
  if (el("trainerExisting")?.checked) return "Existing trainer";
  if (el("trainerNew")?.checked) return "New trainer";
  return "Not specified";
}

function hasAnyPromptDetails() {
  return Object.values(collectStructuredPromptResponses()).some((value) => value.length > 0);
}

function collectStructuredPromptResponses() {
  return {
    workplace_roles: (el("promptWorkplaceRoles")?.value || "").trim(),
    real_life_incidents: (el("promptRealLifeIncidents")?.value || "").trim(),
    professional_development: (el("promptPD")?.value || "").trim(),
    trainer_observations: (el("promptObservations")?.value || "").trim(),
    industry_events: (el("promptEvents")?.value || "").trim(),
    publications_memberships: (el("promptPublications")?.value || "").trim(),
  };
}

function buildStructuredCurrencyInput() {
  const trainerStatus = getTrainerStatusLabel();
  const responses = collectStructuredPromptResponses();

  return `
TRAINER STATUS: ${trainerStatus}

PRIMARY CURRENCY DETAILS (PAST 12 MONTHS)
Note: Details must relate to activities completed within the past 12 months and clearly show how the trainer has stayed engaged with current workplace practice.

1) Relevant workplace roles held (past 12 months):
${responses.workplace_roles || "Not provided"}

2) Real-life incidents responded to (related to this course type):
${responses.real_life_incidents || "Not provided"}

3) Refresher training / professional development completed (attach certificates where available):
${responses.professional_development || "Not provided"}

4) Trainer observations completed:
${responses.trainer_observations || "Not provided"}

5) Industry events or conferences attended:
${responses.industry_events || "Not provided"}

6) Industry publications, updates, or professional memberships (and relevance):
${responses.publications_memberships || "Not provided"}
`.trim();
}

/* =========================
   Collect payload for generate
========================= */
function collectPayloadForGeneration() {
  const firstName = (el("firstName")?.value || "").trim();
  const industryUnitText = (el("industryUnitText")?.value || "").trim();

  const isBlock12 = state.routing?.decision === "block_1_2";

  const employment_current = isBlock12 ? null : {
    employer: (el("curEmployer")?.value || "").trim(),
    job_title: (el("curJobTitle")?.value || "").trim(),
    start_date: el("curStart")?.value || "",
    end_date: el("curEnd")?.value || "",
    tasks: (el("curTasks")?.value || "").trim(),
  };

  const high_risk_fields = isBlock12 ? {
    company: (el("hrCompany")?.value || "").trim(),
    job_title: (el("hrJobTitle")?.value || "").trim(),
    start_date: el("hrStart")?.value || "",
    end_date: el("hrEnd")?.value || "",
    environment_types: (el("hrEnvTypes")?.value || "").trim(),
    tasks: (el("hrTasks")?.value || "").trim(),
    site_or_project: (el("hrSite")?.value || "").trim(),
  } : null;

  const employment_history = isBlock12 ? collectRows("historyList2") : collectRows("historyList");
  const professional_development = isBlock12 ? collectRows("pdList2") : [];
  const certificates = isBlock12 ? collectRows("certList2") : [];

  const structuredPromptResponses = collectStructuredPromptResponses();
  const structuredPrompts = buildStructuredCurrencyInput();

  // Uploads are SECONDARY (supporting evidence). Prompts are PRIMARY.
  const uploadedEvidenceText = [state.resumeText, state.industryEvidenceText]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const combinedEvidenceText = `
${structuredPrompts}

SUPPORTING UPLOADED EVIDENCE (SECONDARY)
${uploadedEvidenceText ? uploadedEvidenceText : "No uploaded documents provided."}
`.trim();

  return {
    first_name: firstName || null,
    industry_unit_text: industryUnitText,
    employment_current,
    employment_history,
    high_risk_fields,
    professional_development,
    certificates,
    health_followup: state.healthFollowup,
    trainer_status: el("trainerExisting")?.checked ? "existing" : el("trainerNew")?.checked ? "new" : "unspecified",
    structured_prompt_responses: structuredPromptResponses,
    uploaded_evidence_text: uploadedEvidenceText,
    evidence_text: combinedEvidenceText || "",
    resume_parsed: state.resumeParsed || null,
  };
}

function validateHighRiskContext() {
  if (state.routing?.decision !== "block_1_2") return true;

  const requiredFields = [
    { id: "hrCompany", label: "Company name" },
    { id: "hrJobTitle", label: "Job title" },
    { id: "hrStart", label: "Start date" },
    { id: "hrEnvTypes", label: "Specific environment types" },
    { id: "hrTasks", label: "Specific tasks performed" },
  ];

  const missing = requiredFields.filter((field) => !((el(field.id)?.value || "").trim()));
  if (!missing.length) return true;

  const message =
    "Please input the Mandatory high-risk employment context before generating. Start with the Company name field in that section, then complete the required job title, start date, environment types and tasks.";
  showError(message);
  showPopupNotification(message, "error");

  const target = el(missing[0]?.id) || el("hrCompany");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  return false;
}

/* =========================
   Generate
========================= */
async function generate() {
  clearMessages();
  resetScoreUI();

  if (!state.routing || (state.routing.decision !== "block_1_1" && state.routing.decision !== "block_1_2")) {
    return showError("Please complete routing first (click Next).");
  }

  const industryUnitText = (el("industryUnitText")?.value || "").trim();
  if (!industryUnitText) return showError("Please enter the industry area, unit code(s) or course name(s).");

  if (!validateHighRiskContext()) return;

  const payload = collectPayloadForGeneration();

  // Friendly tip (does not block)
  if (!hasAnyPromptDetails() && !((state.resumeText || "").trim()) && !((state.industryEvidenceText || "").trim())) {
    showSuccess("Tip: Adding a few optional prompt details will produce a stronger, more specific currency statement.");
  }

  const genBtn = el("generateBtn");
  const regBtn = el("regenBtn");
  if (genBtn) genBtn.disabled = true;
  if (regBtn) regBtn.disabled = true;

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (genBtn) genBtn.disabled = false;
    const msg = err?.error || "Generation failed.";
    showPopupNotification(msg, "error");
    return showError(msg);
  }

  const data = await res.json();

  // Server may return blocked:true (200)
  if (data && data.blocked) {
    if (genBtn) genBtn.disabled = false;
    setButtonsAfterGenerate({ enableCopy: false, enableScore: false });
    const msg = (data.warnings && data.warnings[0]) || "Blocked by relevance checks.";
    showPopupNotification(msg, "error");
    return showError(msg);
  }

  const out = el("outputText");
  if (out) out.value = scrubOutputText(data.output_text || "");

  if (regBtn) regBtn.disabled = false;
  if (genBtn) genBtn.disabled = false;

  // Enable Copy + Currency Check after we have output
  setButtonsAfterGenerate({ enableCopy: true, enableScore: true });

  showSuccess("Generated.");
}

/* =========================
   Copy
========================= */
async function copyOutput() {
  clearMessages();
  const text = el("outputText")?.value || "";
  if (!text.trim()) return showError("Nothing to copy yet.");
  try {
    await navigator.clipboard.writeText(text);
    showSuccess(COPY_SUCCESS_MESSAGE);
    showPopupNotification(COPY_SUCCESS_MESSAGE, "success");
  } catch {
    const msg = "Copy failed. Please select the generated statement and copy it manually.";
    showError(msg);
    showPopupNotification(msg, "error");
  }
}

/* =========================
   Currency Check
========================= */
async function runCurrencyCheck() {
  clearMessages();

  const statement = (el("outputText")?.value || "").trim();
  if (!statement) return showError("Generate a statement first.");

  const scoreBtn = el("scoreBtn");
  if (scoreBtn) scoreBtn.disabled = true;

  setText("scoreResult", "Scoring...");
  show("scoreCard", true);

  const res = await fetch("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      statement,
      routing_block: state.routing?.decision || null,
      industry_unit_text: el("industryUnitText")?.value || "",
    }),
  });

  if (!res.ok) {
    if (scoreBtn) scoreBtn.disabled = false;
    const err = await res.json().catch(() => ({}));
    return showError(err?.error || "Currency Check failed.");
  }

  const data = await res.json();
  renderScore(data);

  if (scoreBtn) scoreBtn.disabled = false;
}

function renderScore(data) {
  const container = el("scoreResult");
  if (!container) return;

  const score = Number(data.overall_score || 0);
  const feedback = Array.isArray(data.feedback) ? data.feedback : [];

  let level = "⚠ Needs Review";
  let color = "#b45309";

  if (score >= 85) { level = "✅ Strong"; color = "#15803d"; }
  else if (score >= 70) { level = "⚠ Needs Minor Edits"; color = "#b45309"; }
  else { level = "❌ Needs Improvement"; color = "#b91c1c"; }

  container.innerHTML = `
    <div style="font-size: 22px; font-weight: 800; margin-bottom: 6px;">
      ${score} / 100
    </div>
    <div style="font-weight: 700; color: ${color}; margin-bottom: 10px;">
      ${level}
    </div>
    <ul style="margin: 0; padding-left: 18px;">
      ${(feedback.length ? feedback : ["No feedback returned."]).map(f => `<li>${f}</li>`).join("")}
    </ul>
  `;
}

/* =========================
   Reset
========================= */
function resetAll() {
  hidePopupNotification();

  state.routing = null;
  state.askedClarify = false;
  state.resumeText = "";
  state.industryEvidenceText = "";
  state.resumeParsed = null;
  state.healthFollowup = { workplace: "", start_date: "" };

  document.querySelectorAll("input, textarea").forEach((field) => {
    if (field.type === "radio" || field.type === "checkbox") {
      field.checked = false;
      return;
    }
    field.value = "";
  });

  // files
  if (el("resumeFiles")) el("resumeFiles").value = "";
  if (el("industryEvidenceFiles")) el("industryEvidenceFiles").value = "";
  setText("resumeFileName", "");
  setText("industryEvidenceFileName", "");

  // summaries
  setText("resumeSummary", "");
  setText("industryEvidenceSummary", "");
  clearDynamicRows();

  // output
  if (el("outputText")) el("outputText").value = "";

  // blocks
  setText("blockTitle", "Block (not selected)");
  setText("blockSubtitle", "Enter industry/unit text and click Next to load the correct block.");
  show("block11", false);
  show("block12", false);
  show("healthFollowup", false);

  // routing card
  show("routingCard", false);
  show("clarifyWrap", false);
  setText("routingStatus", "");
  setText("clarifyQuestion", "");

  // buttons
  if (el("generateBtn")) el("generateBtn").disabled = true;
  if (el("regenBtn")) el("regenBtn").disabled = true;
  setButtonsAfterGenerate({ enableCopy: false, enableScore: false });
  resetScoreUI();

  clearMessages();
}

/* =========================
   Event wiring
========================= */
function wire() {
  el("routeBtn")?.addEventListener("click", route);
  el("resetBtn")?.addEventListener("click", resetAll);
  el("copyResetBtn")?.addEventListener("click", resetAll);

  el("clarifySubmitBtn")?.addEventListener("click", () => {
    const ans = (el("clarifyAnswer")?.value || "").trim();
    if (!ans) return showError("Please answer the question so we can continue.");
    route();
  });

  el("generateBtn")?.addEventListener("click", generate);
  el("regenBtn")?.addEventListener("click", generate);

  el("copyBtn")?.addEventListener("click", copyOutput);
  el("scoreBtn")?.addEventListener("click", runCurrencyCheck);

  el("addHistoryBtn")?.addEventListener("click", () => addHistoryRow("historyList"));
  el("addHistoryBtn2")?.addEventListener("click", () => addHistoryRow("historyList2"));
  el("addPdBtn2")?.addEventListener("click", () => addPdRow("pdList2"));
  el("addCertBtn2")?.addEventListener("click", () => addCertRow("certList2"));

  // Auto-extract on file choose
  const resumeInput = el("resumeFiles");
  if (resumeInput) {
    resumeInput.addEventListener("change", () => {
      if (resumeInput.files && resumeInput.files.length) {
        parseUploadsFromInput("resumeFiles", "resumeSummary", "resumeText");
      } else {
        setText("resumeSummary", "");
      }
    });
  }

  const industryInput = el("industryEvidenceFiles");
  if (industryInput) {
    industryInput.addEventListener("change", () => {
      if (industryInput.files && industryInput.files.length) {
        parseUploadsFromInput("industryEvidenceFiles", "industryEvidenceSummary", "industryEvidenceText");
      } else {
        setText("industryEvidenceSummary", "");
      }
    });
  }

  // Show selected filenames nicely
  attachFileName("resumeFiles", "resumeFileName");
  attachFileName("industryEvidenceFiles", "industryEvidenceFileName");
}

wire();
resetAll();
