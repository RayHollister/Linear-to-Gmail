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
const PROP_DEFAULT_PRIORITY = "LINEAR_DEFAULT_PRIORITY";

/** Entry points **/
function onHomepage(e) {
  return buildSettingsOrWelcomeCard_();
}

function onGmailMessageOpen(e) {
  if (!getApiKey_()) {
    return buildSettingsCard_("Before creating issues, add your Linear API key.");
  }
  try {
    const threadData = getThreadDataFromEvent_(e);
    
    // Check if any message in the thread already has an issue
    const existingIssues = linearSearchForThread_(threadData.searchCriteria);
    
    if (existingIssues.length > 0) {
      return buildExistingIssuesCard_(existingIssues, threadData.message);
    }

    return buildIssueComposerCard_(threadData.message);
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
    .setValue("") // Make the description field blank by default
    .setMultiline(true);
  const teamInput = buildTeamTypeaheadWidget_();
  const priorityInput = buildPrioritySelector_(); // Create the priority selector

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

  mainSection.addWidget(priorityInput); // Add priority selector to the card
  mainSection.addWidget(createBtn);

  return CardService.newCardBuilder()
    .setHeader(header)
    .addSection(mainSection)
    .build();
}

function buildExistingIssuesCard_(issues, currentMessage) {
  const header = CardService.newCardHeader()
    .setImageUrl("https://rayhollister.com/Linear-to-Gmail/linear-for-gmail-icon-128.png")
    .setImageStyle(CardService.ImageStyle.CIRCLE)
    .setTitle("Existing Issues Found");

  const cardBuilder = CardService.newCardBuilder().setHeader(header);

  issues.forEach(issue => {
    const openInLinearButton = CardService.newTextButton()
      .setText(`<b>Open ${issue.identifier} in Linear</b>`)
      .setOpenLink(CardService.newOpenLink().setUrl(issue.url))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor("#555fbd");
      
    const dueDateString = issue.dueDate
      ? Utilities.formatDate(new Date(issue.dueDate), "UTC", "MM/dd/yyyy")
      : 'None';

    const priorityWidget = CardService.newDecoratedText()
      .setTopLabel("Priority")
      .setText(getPriorityLabel_(issue.priority))
      .setStartIcon(CardService.newIconImage().setIconUrl(getPriorityIconUrl_(issue.priority)));

    const section = CardService.newCardSection()
      .addWidget(CardService.newKeyValue().setTopLabel("Title").setContent(issue.title))
      .addWidget(CardService.newKeyValue().setTopLabel("Status").setContent(issue.state.name))
      .addWidget(priorityWidget)
      .addWidget(CardService.newKeyValue().setTopLabel("Due Date").setContent(dueDateString))
      .addWidget(CardService.newKeyValue().setTopLabel("Assignee").setContent(issue.assignee ? issue.assignee.name : 'Unassigned'))
      .addWidget(openInLinearButton);
      
    cardBuilder.addSection(section);
  });
  
  const createNewAction = CardService.newAction()
    .setFunctionName("handleNavCreateIssue_")
    .setParameters({ messageId: currentMessage.id, threadId: currentMessage.threadId });
    
  const createNewButton = CardService.newTextButton()
    .setText("Create New Issue")
    .setOnClickAction(createNewAction)
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT);
    
  const finalSection = CardService.newCardSection().addWidget(createNewButton);
  cardBuilder.addSection(finalSection);
        
  return cardBuilder.build();
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
function handleNavCreateIssue_(e) {
  const threadData = getThreadDataFromEvent_(e);
  return buildIssueComposerCard_(threadData.message);
}

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
  const userDescription = getSingleValue_(inputs, "description");
  const teamQuery = getSingleValue_(inputs, "teamQuery");
  const priority = getSingleValue_(inputs, "priority");

  const messageId = params.messageId;
  const threadId = params.threadId;
  if (!getApiKey_()) return buildSettingsCard_("Add your API key to continue.");
  if (!title) return buildErrorCard_("Title is required.");
  if (!messageId || !threadId) return buildErrorCard_("Missing message context.");

  // Resolve team
  const teams = safeFetchTeams_();
  const resolvedTeamId = resolveTeamIdByQuery_(teams, teamQuery) || getDefaultTeamId_();
  if (!resolvedTeamId) {
    return buildErrorCard_("Could not resolve a team from your input. Try typing the exact team name or key.");
  }

  try {
    const msg = GmailApp.getMessageById(messageId);
    
    // Convert the email body to Markdown
    const emailBody = htmlToMarkdown_(msg.getBody());
    
    // Create a unique, visible identifier for this email
    const cleanMessageId = msg.getHeader("Message-ID").replace(/[<>]/g, "");
    const emailIdentifier = `gmail_message_id:${cleanMessageId}`;

    // Create the collapsible section with a linked subject line and the visible ID
    const collapsibleSection = 
      `\n\n+++ Created from Gmail: [${msg.getSubject()}](${buildGmailPermalink_(threadId)})\n\n` +
      `${emailBody}\n\n` +
      `${emailIdentifier}\n\n` +
      `+++`;
      
    // Assemble the final description, with user's text first
    const finalDesc = [userDescription, collapsibleSection].filter(Boolean).join('\n\n');

    const priorityInt = parseInt(priority, 10);
    const result = linearCreateIssue_(resolvedTeamId, title, finalDesc, priorityInt);
    const url = result?.data?.issueCreate?.issue?.url;
    if (!url) throw new Error("Missing Linear URL in response.");

    // --- SAVE THE LAST USED TEAM AND PRIORITY ---
    USER_PROPS.setProperty(PROP_DEFAULT_TEAM_ID, resolvedTeamId);
    if (!isNaN(priorityInt)) {
      USER_PROPS.setProperty(PROP_DEFAULT_PRIORITY, priorityInt.toString());
    }

    const success = CardService.newCardSection()
      .addWidget(CardService.newKeyValue().setTopLabel("Success").setContent("Issue created"))
      .addWidget(CardService.newTextButton().setText("Open in Linear").setOpenLink(CardService.newOpenLink().setUrl(url)))
      .addWidget(CardService.newTextButton().setText("Open this email in Gmail").setOpenLink(CardService.newOpenLink().setUrl(buildGmailPermalink_(threadId))));
    return CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle("Linear issue created"))
      .addSection(success)
      .build();
  } catch (err) {
    return buildErrorCard_("Failed to create issue. " + err);
  }
}

/** Helpers – Gmail **/
function getThreadDataFromEvent_(e) {
  const messageId = e.gmail?.messageId || e.commonEventObject?.parameters?.messageId;
  if (!messageId) throw new Error("No messageId in event.");

  const currentMessage = GmailApp.getMessageById(messageId);
  const thread = currentMessage.getThread();
  const messages = thread.getMessages();

  // Create search criteria for the entire thread
  const searchCriteria = messages.flatMap(m => {
    const messageIdHeader = m.getHeader("Message-ID");
    const subject = m.getSubject();
    
    if (!messageIdHeader || !subject) return [];
    
    // Search for both the add-on's tag and the issue title
    return [
      { description: { contains: `gmail_message_id:${messageIdHeader.replace(/[<>]/g, "")}` } },
      { title: { eq: subject } }
    ];
  });

  return {
    message: { // Data for the currently open message
      id: currentMessage.getId(),
      threadId: thread.getId(),
      from: currentMessage.getFrom(),
      subject: currentMessage.getSubject(),
      date: currentMessage.getDate(),
      htmlBody: currentMessage.getBody(),
      messageId: currentMessage.getHeader("Message-ID")
    },
    searchCriteria: searchCriteria // Array of search filters for the thread
  };
}


function buildGmailPermalink_(threadId) {
  return "https://mail.google.com/mail/u/0/#inbox/" + encodeURIComponent(threadId);
}

function safeSubject_(s) {
  return (s || "").substring(0, 240);
}

function buildDefaultDescription_(msg) {
  return ""; // Keep the description field blank by default
}

function getSingleValue_(inputs, name) {
  return (inputs[name]?.stringInputs?.value || [])[0] || "";
}

function getPriorityLabel_(priorityValue) {
  const priorities = { '0': 'No priority', '1': 'Urgent', '2': 'High', '3': 'Medium', '4': 'Low' };
  return priorities[String(priorityValue)] || 'None';
}

function getPriorityIconUrl_(priorityValue) {
  switch (String(priorityValue)) {
    case '1': // Urgent
      return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cmVjdCB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHJ4PSIzIiByeT0iMyIgZmlsbD0iIzU1NWZiZCIvPjxyZWN0IHg9IjciIHk9IjQiIHdpZHRoPSIyIiBoZWlnaHQ9IjYiIHJ4PSIxIiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iOCIgY3k9IjEyLjUiIHI9IjEiIGZpbGw9IiNmZmYiLz48L3N2Zz4=";
    case '2': // High
      return "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iIzU1NWZiZCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSIxLjUiIHk9IjgiIHdpZHRoPSIzIiBoZWlnaHQ9IjYiIHJ4PSIxIi8+PHJlY3QgeD0iNi41IiB5PSI1IiB3aWR0aD0iMyIgaGVpZ2h0PSI5IiByeD0iMSIvPjxyZWN0IHg9IjExLjUiIHk9IjIiIHdpZHRoPSIzIiBoZWlnaHQ9IjEyIiByeD0iMSIvPjwvc3ZnPg==";
    case '3': // Medium
      return "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iIzU1NWZiZCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSIxLjUiIHk9IjgiIHdpZHRoPSIzIiBoZWlnaHQ9IjYiIHJ4PSIxIi8+PHJlY3QgeD0iNi41IiB5PSI1IiB3aWR0aD0iMyIgaGVpZ2h0PSI5IiByeD0iMSIvPjxyZWN0IHg9IjExLjUiIHk9IjIiIHdpZHRoPSIzIiBoZWlnaHQ9IjEyIiByeD0iMSIgZmlsbC1vcGFjaXR5PSIwLjQiLz48L3N2Zz4=";
    case '4': // Low
      return "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0iIzU1NWZiZCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSIxLjUiIHk9IjgiIHdpZHRoPSIzIiBoZWlnaHQ9IjYiIHJ4PSIxIi8+PHJlY3QgeD0iNi41IiB5PSI1IiB3aWR0aD0iMyIgaGVpZ2h0PSI5IiByeD0iMSIgZmlsbC1vcGFjaXR5PSIwLjQiLz48cmVjdCB4PSIxMS41IiB5PSIyIiB3aWR0aD0iMyIgaGVpZ2h0PSIxMiIgcng9IjEiIGZpbGwtb3BhY2l0eT0iMC40Ii8+PC9zdmc+";
    case '0': // No Priority
    default:
      return "data:image/svg+xml;base64,PHN2ZyBhcmlhLWxhYmVsPSJObyBQcmlvcml0eSIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiB2aWV3Qm94PSIwIDAgMTYgMTYiIHJvbGU9ImltZyIgZm9jdXNhYmxlPSJmYWxzZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB4PSIxLjUiIHk9IjcuMjUiIHdpZHRoPSIzIiBoZWlnaHQ9IjEuNSIgcng9IjAuNSIgb3BhY2l0eT0iMC45IiBmaWxsPSIjNTU1ZmJkIi8+PHJlY3QgeD0iNi41IiB5PSI3LjI1IiB3aWR0aD0iMyIgaGVpZ2h0PSIxLjUiIHJ4PSIwLjUiIG9wYWNpdHk9IjAuOSIgc3R5bGU9ImZpbGw6IzU1NWZiZCIvPjxyZWN0IHg9IjExLjUiIHk9IjcuMjUiIHdpZHRoPSIzIiBoZWlnaHQ9IjEuNSIgcng9IjAuNSIgb3BhY2l0eT0iMC45IiBzdHlsZT0iZmlsbDojNTU1ZmJkIi8+PC9zdmc+";
  }
}

/** Helpers – HTML to Markdown **/
function htmlToMarkdown_(html) {
  if (!html) return "";

  // A more robust HTML to Markdown converter for Linear
  return html
    // Remove scripts, styles, and head
    .replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, '')
    .replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, '')
    .replace(/<head[^>]*>([\S\s]*?)<\/head>/gmi, '')
    // Convert links
    .replace(/<a.*?href=["'](.*?)["'].*?>(.*?)<\/a>/gi, '[$2]($1)')
    // Block elements with newlines
    .replace(/<(p|div|h1|h2|h3|h4|h5|h6)[^>]*>/gi, '\n')
    // List items
    .replace(/<li[^>]*>/gi, '\n* ')
    // Line breaks
    .replace(/<br[^>]*>/gi, '\n')
    // Bold and italic
    .replace(/<(strong|b)>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)>/gi, '_').replace(/<\/(em|i)>/gi, '_')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Clean up extra whitespace and newlines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


/** Helpers – Team input & resolution **/
function buildTeamTypeaheadWidget_() {
  try {
    const teams = linearFetchTeams_();
    if (!teams.length) return null;

    const defaultTeamId = getDefaultTeamId_();
    const defaultTeam = teams.find(t => t.id === defaultTeamId);
    const defaultValue = defaultTeam ? defaultTeam.name : "";

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
    suggestions.slice(0, 100).forEach(s => sugg.addSuggestion(s));

    const hint = "Type team name, key (e.g., ENG) or paste team ID";
    const input = CardService.newTextInput()
      .setFieldName("teamQuery")
      .setTitle("Team")
      .setHint(hint)
      .setSuggestions(sugg);

    if (defaultValue) {
      input.setValue(defaultValue);
    }
    
    return input;
  } catch (err) {
    return null;
  }
}

function buildPrioritySelector_() {
  const lastPriority = USER_PROPS.getProperty(PROP_DEFAULT_PRIORITY) || "0"; // Default to "0" (No Priority)

  return CardService.newSelectionInput()
    .setFieldName("priority")
    .setTitle("Priority")
    .setType(CardService.SelectionInputType.DROPDOWN)
    .addItem("No priority", "0", lastPriority === "0")
    .addItem("Urgent", "1", lastPriority === "1")
    .addItem("High", "2", lastPriority === "2")
    .addItem("Medium", "3", lastPriority === "3")
    .addItem("Low", "4", lastPriority === "4");
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
function linearSearchForThread_(searchCriteria) {
  if (!searchCriteria || searchCriteria.length === 0) {
    return [];
  }

  const query = `
    query Issues($filter: IssueFilter) {
      issues(filter: $filter) {
        nodes {
          id
          title
          description
          identifier
          url
          state { name }
          priority
          dueDate
          assignee { name }
        }
      }
    }
  `;

  const filter = { or: searchCriteria };
  
  const resp = linearRequest_(query, { filter });
  return resp?.data?.issues?.nodes || [];
}

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

function linearCreateIssue_(teamId, title, description, priority) {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url title }
      }
    }
  `;
  const input = { teamId, title, description };
  // Only add priority to the input if it's a valid number and not "No Priority" (0)
  if (!isNaN(priority) && priority > 0) {
    input.priority = priority;
  }
  
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