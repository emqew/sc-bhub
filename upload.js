const { google } = require('googleapis');
const formidable = require('formidable');
const fs = require('fs');

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data
    const form = formidable({ maxFileSize: 4 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);
    
    // Verify password
    const password = fields.password?.[0];
    if (password !== process.env.UPLOAD_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Get fields
    const cleanName = fields.cleanName?.[0];
    const segment = fields.segment?.[0];
    const industry = fields.industry?.[0];
    const usecase = fields.usecase?.[0];
    const product = fields.product?.[0];
    const category = fields.category?.[0];
    const subcategory = fields.subcategory?.[0];
    
    if (!cleanName || !segment || !industry || !usecase || !product || !category || !subcategory) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    // Get file extension from original name
    const originalName = file.originalFilename || 'upload';
    const ext = originalName.split('.').pop().toLowerCase();
    
    // Build filename per naming convention
    const cleanSlug = cleanName.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    
    const newFilename = `${cleanSlug}_${segment}_${industry}_${usecase}_${product}.${ext}`;
    
    // Authenticate
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const folderId = process.env.GOOGLE_FOLDER_ID;
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    
    const drive = google.drive({ version: 'v3', auth });
    
    // Find the target folder: root > category > subcategory
    const catFolderRes = await drive.files.list({
      q: `'${folderId}' in parents and name='${category}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });
    
    if (!catFolderRes.data.files.length) {
      return res.status(400).json({ error: `Category folder "${category}" not found` });
    }
    
    const catFolderId = catFolderRes.data.files[0].id;
    
    const subFolderRes = await drive.files.list({
      q: `'${catFolderId}' in parents and name='${subcategory}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });
    
    if (!subFolderRes.data.files.length) {
      return res.status(400).json({ error: `Subcategory folder "${subcategory}" not found in ${category}` });
    }
    
    const subFolderId = subFolderRes.data.files[0].id;
    
    // Upload file
    const fileMetadata = {
      name: newFilename,
      parents: [subFolderId],
    };
    
    const media = {
      mimeType: file.mimetype || 'application/octet-stream',
      body: fs.createReadStream(file.filepath),
    };
    
    const uploadRes = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink',
    });
    
    res.status(200).json({
      success: true,
      filename: newFilename,
      fileId: uploadRes.data.id,
      url: uploadRes.data.webViewLink,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
}
