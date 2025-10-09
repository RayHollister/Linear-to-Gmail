/**
 * This file contains temporary functions for troubleshooting.
 */

function troubleshootAttachment() {
  try {
    console.log("--- STARTING ATTACHMENT TEST ---");

    // --- 1. Create a Test Issue ---
    const testIssueTitle = "Attachment Test Issue " + new Date().toLocaleTimeString();
    console.log("Creating a test issue with title: " + testIssueTitle);
    
    // Replace "YOUR_TEAM_ID" with a valid Team ID from your Linear workspace
    const testTeamId = "TEST"; 
    
    const issueResult = linearCreateIssue_(testTeamId, testIssueTitle, "Test description", 0);
    const issueId = issueResult?.data?.issueCreate?.issue?.id;
    if (!issueId) {
      throw new Error("Failed to create a test issue. Response: " + JSON.stringify(issueResult));
    }
    console.log("Successfully created test issue with ID: " + issueId);

    // --- 2. Create and Upload a Test HTML File ---
    const fakeHtmlContent = "<h1>Test HTML</h1><p>This is a test file.</p>";
    const blob = Utilities.newBlob(fakeHtmlContent, 'text/html', 'test-email.html');
    console.log("Created a test blob. Name: " + blob.getName() + ", Type: " + blob.getContentType());
    
    const assetUrl = uploadFileToLinear_(blob);
    if (!assetUrl) {
      throw new Error("Failed to upload test file.");
    }
    console.log("Successfully uploaded file. Asset URL: " + assetUrl);
    
    // --- 3. Attach the File to the Issue ---
    console.log("Attaching file to issue...");
    const attachmentResult = linearAttachUrl_(issueId, assetUrl, "Test HTML Attachment");
    
    console.log("--- ATTACHMENT ATTEMPT COMPLETE ---");
    console.log("Attachment Result:", JSON.stringify(attachmentResult, null, 2));

  } catch (err) {
    console.error("--- ERROR DURING TROUBLESHOOTING ---");
    console.error(err.toString());
  }
}


// --- Helper functions copied from Code.gs for this standalone script to work ---

function getApiKey_() {
  return PropertiesService.getUserProperties().getProperty("LINEAR_API_KEY");
}

function linearRequest_(query, variables) {
  const LINEAR_API_ENDPOINT = "https://api.linear.app/graphql";
  const apiKey = getApiKey_();
  if (!apiKey) throw new Error("No API key set.");
  const payload = JSON.stringify({ query, variables });

  const res = UrlFetchApp.fetch(LINEAR_API_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: apiKey },
    payload,
    muteHttpExceptions: true
  });
  
  const body = res.getContentText();
  const json = JSON.parse(body);
  if (json.errors && json.errors.length) {
    throw new Error("Linear API returned errors: " + JSON.stringify(json.errors));
  }
  return json;
}

function linearCreateIssue_(teamId, title, description, priority) {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id }
      }
    }
  `;
  const input = { teamId, title, description };
  if (!isNaN(priority) && priority > 0) {
    input.priority = priority;
  }
  return linearRequest_(mutation, { input });
}

function uploadFileToLinear_(blob) {
  const fileUploadMutation = `
    mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        uploadFile {
          uploadUrl
          assetUrl
          headers {
            key
            value
          }
        }
      }
    }
  `;

  const uploadVars = {
    contentType: blob.getContentType(),
    filename: blob.getName(),
    size: blob.getBytes().length
  };

  const uploadPayload = linearRequest_(fileUploadMutation, uploadVars);
  const uploadData = uploadPayload?.data?.fileUpload?.uploadFile;

  if (!uploadData || !uploadData.uploadUrl) {
    throw new Error("Failed to get Linear upload URL.");
  }

  const headers = uploadData.headers.reduce((acc, header) => {
    acc[header.key] = header.value;
    return acc;
  }, {});
  headers['Content-Type'] = blob.getContentType();
  
  UrlFetchApp.fetch(uploadData.uploadUrl, {
    method: "put",
    headers: headers,
    payload: blob.getBytes()
  });

  return uploadData.assetUrl;
}

function linearAttachUrl_(issueId, url, title) {
  const mutation = `
    mutation AttachmentCreate($issueId: String!, $url: String!, $title: String!) {
      attachmentCreate(input: { issueId: $issueId, url: $url, title: $title }) {
        success
      }
    }
  `;
  return linearRequest_(mutation, { issueId, url, title });
}