/***** Linear for Gmail – Apps Script Add-on (type-ahead teams, sorted)
 * - Team suggestions are sorted: name (A→Z, case-insensitive), then key
 * - Type-ahead accepts team name, key, or id;
 resolves to teamId on submit
 * - No "Bearer " prefix in Authorization header (Linear API expects raw key)
 * - Hidden inputs removed;
 message/thread IDs passed via action parameters
 *************************************************/

/** Constants **/
const LINEAR_API_ENDPOINT = "https://api.linear.app/graphql";
const USER_PROPS = PropertiesService.getUserProperties();
const PROP_API_KEY = "LINEAR_API_KEY";
const PROP_DEFAULT_TEAM_ID = "LINEAR_DEFAULT_TEAM_ID";

/** Entry points **/
function onHomepage(e) {
  return buildSettingsOrWelcomeCard_();
}

function onGmailMessageOpen(e) {
  if (!getApiKey_()) {
    return buildSettingsCard_("Before creating issues, add your Linear API key.");
  }
  try {
    const msg = getMessageFromEvent_(e);
    return buildIssueComposerCard_(msg);
  } catch (err) {
    return buildErrorCard_("Could not read this message. " + err);
  }
}

/** UI – Cards **/
function buildSettingsOrWelcomeCard_() {
  if (!getApiKey_()) {
    return buildSettingsCard_("Add your Linear API key to get started.");
  }

  // Build the welcome card with a persistent Settings button
  const settingsAction = CardService.newAction().setFunctionName("handleNavSettings_");
  const settingsButton = CardService.newTextButton()
    .setText("Settings")
    .setOnClickAction(settingsAction)
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT);

  const section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText("Open any email to create an issue."))
    .addWidget(settingsButton);
    
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Linear for Gmail is ready"))
    .addSection(section)
    .build();
}

function buildSettingsCard_(subtitle) {
  const apiKey = getApiKey_() || "";
  const header = CardService.newCardHeader()
    .setTitle("Linear settings")
    .setSubtitle(subtitle || "");
  const apiKeyInput = CardService.newTextInput()
    .setFieldName("apiKey")
    .setTitle("Linear personal API key")
    .setHint("Create at linear.app → Settings → API")
    .setValue(apiKey);
  const saveAction = CardService.newAction().setFunctionName("handleSaveSettings_");
  const saveBtn = CardService.newTextButton()
    .setText("Save")
    .setOnClickAction(saveAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED);
  const refreshTeamsAction = CardService.newAction().setFunctionName("handleRefreshTeams_");
  const refreshBtn = CardService.newTextButton().setText("Refresh teams").setOnClickAction(refreshTeamsAction);

  const section = CardService.newCardSection()
    .addWidget(apiKeyInput)
    .addWidget(saveBtn)
    .addWidget(refreshBtn);
  // Show the type-ahead field here too so you can test it in Settings
  const teamInput = buildTeamTypeaheadWidget_();
  if (teamInput) section.addWidget(teamInput);

  return CardService.newCardBuilder()
    .setHeader(header)
    .addSection(section)
    .build();
}

function buildIssueComposerCard_(msg) {
  // Create a new card header with the Linear logo
  const header = CardService.newCardHeader()
    .setImageUrl("https://rayhollister.com/Linear-to-Gmail/linear-for-gmail-icon-128.png")
    .setImageStyle(CardService.ImageStyle.CIRCLE)
    .setTitle("Create Linear Issue")
    
  const titleInput = CardService.newTextInput()
    .setFieldName("title")
    .setTitle("Title")
    .setValue(safeSubject_(msg.subject));
  const descInput = CardService.newTextInput()
    .setFieldName("description")
    .setTitle("Description")
    .setValue(buildDefaultDescription_(msg))
    .setMultiline(true);
  const teamInput = buildTeamTypeaheadWidget_();

  // Pass message/thread IDs to the action as parameters
  const createAction = CardService.newAction()
    .setFunctionName("handleCreateIssue_")
    .setParameters({ messageId: msg.id, threadId: msg.threadId });

  // Create and style the "Create issue" button
  const createBtn = CardService.newTextButton()
    .setText("<b>Create issue in Linear</b>")
    .setOnClickAction(createAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor("#555fbd");

  const mainSection = CardService.newCardSection()
    .addWidget(titleInput)
    .addWidget(descInput);

  if (teamInput) {
    mainSection.addWidget(teamInput);
  } else {
    mainSection.addWidget(
      CardService.newKeyValue()
        .setTopLabel("Team")
        .setContent("No teams loaded. Open Settings and click Refresh teams.")
    );
  }

  mainSection.addWidget(createBtn);

  return CardService.newCardBuilder()
    .setHeader(header)
    .addSection(mainSection)
    .build();
}


function buildSimpleCard_(title, subtitle) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(title))
    .build();
}

function buildErrorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle("Error"))
    .addSection(CardService.newCardSection().addWidget(CardService.newTextParagraph().setText(message)))
    .build();
}

/** Actions **/
function handleSaveSettings_(e) {
  const apiKey = (e.commonEventObject.formInputs.apiKey?.stringInputs?.value || [])[0] || "";
  if (!apiKey) {
    return buildErrorCard_("API key is required.");
  }
  USER_PROPS.setProperty(PROP_API_KEY, apiKey);
  try {
    const teams = linearFetchTeams_(); // already sorted
    if (teams.length) USER_PROPS.setProperty(PROP_DEFAULT_TEAM_ID, teams[0].id);
    return buildSettingsCard_("Saved. Loaded " + teams.length + " team(s).");
  } catch (err) {
    return buildSettingsCard_("Saved API key, but could not load teams. " + err);
  }
}

function handleRefreshTeams_(e) {
  try {
    const teams = linearFetchTeams_();
    // already sorted
    if (teams.length && !getDefaultTeamId_()) {
      USER_PROPS.setProperty(PROP_DEFAULT_TEAM_ID, teams[0].id);
    }
    return buildSettingsCard_("Refreshed teams. Found " + teams.length + ".");
  } catch (err) {
    return buildSettingsCard_("Could not refresh teams. " + err);
  }
}

function handleNavSettings_(e) {
  return buildSettingsCard_("Update your API key or default team.");
}

function handleCreateIssue_(e) {
  const inputs = e.commonEventObject.formInputs || {};
  const params = e.commonEventObject.parameters || {};
  const title = getSingleValue_(inputs, "title");
  const description = getSingleValue_(inputs, "description");
  const teamQuery = getSingleValue_(inputs, "teamQuery");
  // user-typed team
  const messageId = params.messageId;
  const threadId = params.threadId;
  if (!getApiKey_()) return buildSettingsCard_("Add your API key to continue.");
  if (!title) return buildErrorCard_("Title is required.");
  if (!messageId || !threadId) return buildErrorCard_("Missing message context.");

  // Resolve team
  const teams = safeFetchTeams_();
  // already sorted
  const resolvedTeamId = resolveTeamIdByQuery_(teams, teamQuery) || getDefaultTeamId_();
  if (!resolvedTeamId) {
    return buildErrorCard_("Could not resolve a team from your input. Try typing the exact team name or key.");
  }

  try {
    const msg = GmailApp.getMessageById(messageId);
    const emailUrl = buildGmailPermalink_(threadId);
    const headerBlock = buildHeaderBlock_(msg, emailUrl);
    const finalDesc = headerBlock + "\n\n" + (description || "").trim();

    const result = linearCreateIssue_(resolvedTeamId, title, finalDesc);
    const url = result?.data?.issueCreate?.issue?.url;
    if (!url) throw new Error("Missing Linear URL in response.");

    const success = CardService.newCardSection()
      .addWidget(CardService.newKeyValue().setTopLabel("Success").setContent("Issue created"))
      .addWidget(CardService.newTextButton().setText("Open in Linear").setOpenLink(CardService.newOpenLink().setUrl(url)))
      .addWidget(CardService.newTextButton().setText("Open this email in Gmail").setOpenLink(CardService.newOpenLink().setUrl(emailUrl)));
    return CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle("Linear issue created"))
      .addSection(success)
      .build();
  } catch (err) {
    return buildErrorCard_("Failed to create issue. " + err);
  }
}

/** Helpers – Gmail **/
function getMessageFromEvent_(e) {
  const msgId = e.gmail?.messageId || e.commonEventObject?.parameters?.messageId;
  if (!msgId) throw new Error("No messageId in event.");
  const m = GmailApp.getMessageById(msgId);
  const thread = m.getThread();
  return {
    id: m.getId(),
    threadId: thread.getId(),
    from: m.getFrom(),
    subject: m.getSubject(),
    date: m.getDate(),
    plainBody: truncate_(m.getPlainBody(), 7500)
  };
}

function buildGmailPermalink_(threadId) {
  return "https://mail.google.com/mail/u/0/#inbox/" + encodeURIComponent(threadId);
}

function safeSubject_(s) {
  return (s || "").substring(0, 240);
}

function buildDefaultDescription_(msg) {
  return [msg.plainBody || ""].join("\n").trim();
}

function buildHeaderBlock_(gmailMessage, emailUrl) {
  return [
    "**Created from Gmail**",
    `**Subject:** [${gmailMessage.getSubject()}](${emailUrl})`
  ].join("\n");
}

function truncate_(s, n) {
  if (!s) return "";
  return s.length > n ? s.substring(0, n) + "\n…[truncated]" : s;
}

function getSingleValue_(inputs, name) {
  return (inputs[name]?.stringInputs?.value || [])[0] || "";
}

/** Helpers – Team input & resolution **/
function buildTeamTypeaheadWidget_() {
  try {
    const teams = linearFetchTeams_();
    // sorted
    if (!teams.length) return null;

    // Build suggestions from names and keys (deduped, in sorted team order)
    const seen = {};
    const suggestions = [];
    teams.forEach(t => {
      const name = t.name || "";
      const key = t.key || "";
      if (name && !seen[name.toLowerCase()]) {
        suggestions.push(name);
        seen[name.toLowerCase()] = true;
      }
      if (key && !seen[key.toLowerCase()]) {
        suggestions.push(key);
        seen[key.toLowerCase()] = true;
      }
    
    });

    const sugg = CardService.newSuggestions();
    suggestions.slice(0, 100).forEach(s => sugg.addSuggestion(s)); // preserve sorted order

    const hint = "Type team name, key (e.g., ENG) or paste team ID";
    const input = CardService.newTextInput()
      .setFieldName("teamQuery")
      .setTitle("Team")
      .setHint(hint)
      .setSuggestions(sugg);
    return input;
  } catch (err) {
    return null;
  }
}

function safeFetchTeams_() {
  try {
    return linearFetchTeams_();
  } catch (e) {
    return [];
  }
}

function resolveTeamIdByQuery_(teams, queryRaw) {
  if (!teams || !teams.length) return "";
  if (!queryRaw) return "";
  const q = String(queryRaw).trim().toLowerCase();
  // Exact/loose match by id, key, or name
  let candidate = teams.find(t => (t.id || "").toLowerCase() === q);
  if (candidate) return candidate.id;

  candidate = teams.find(t => (t.key || "").toLowerCase() === q);
  if (candidate) return candidate.id;
  candidate = teams.find(t => (t.name || "").toLowerCase() === q);
  if (candidate) return candidate.id;
  // Prefix/contains fallback
  candidate = teams.find(t => (t.name || "").toLowerCase().startsWith(q) || (t.key || "").toLowerCase().startsWith(q));
  if (candidate) return candidate.id;
  candidate = teams.find(t => (t.name || "").toLowerCase().includes(q) || (t.key || "").toLowerCase().includes(q));
  if (candidate) return candidate.id;

  return "";
}

/** Linear API – core **/
function linearFetchTeams_() {
  const query = `
    query MyTeams {
      teams(first: 200) { nodes { id name key } }
    }
  `;
  const resp = linearRequest_(query, {});
  const nodes = resp?.data?.teams?.nodes || [];
  return sortTeams_(nodes);
}

function linearCreateIssue_(teamId, title, description) {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }
  `;
  const input = { teamId, title, description };
  return linearRequest_(mutation, { input });
}

function linearRequest_(query, variables) {
  const apiKey = getApiKey_();
  if (!apiKey) throw new Error("No API key set.");
  const payload = JSON.stringify({ query, variables });

  const res = UrlFetchApp.fetch(LINEAR_API_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: apiKey }, // IMPORTANT: no "Bearer " prefix
    payload,
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Linear API error " + code + ": " + body);
  }
  const json = JSON.parse(body);
  if (json.errors && json.errors.length) {
    throw new Error("Linear API returned errors: " + JSON.stringify(json.errors));
  }
  return json;
}

/** Sorting **/
function sortTeams_(teams) {
  return (teams || []).slice().sort((a, b) => {
    const an = (a.name || "").toLowerCase();
    const bn = (b.name || "").toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;

    const ak = (a.key || "").toLowerCase();
    const bk = (b.key || "").toLowerCase();
    if (ak !== bk) return ak < bk ? -1 : 1;

    const ai = a.id || "";
    const bi = b.id || 
"";
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

/** Properties **/
function getApiKey_() {
  return USER_PROPS.getProperty(PROP_API_KEY);
}

function getDefaultTeamId_() {
  return USER_PROPS.getProperty(PROP_DEFAULT_TEAM_ID);
}