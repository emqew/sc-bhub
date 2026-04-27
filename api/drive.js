const { google } = require('googleapis');

const THUMB_COLORS = {
  'Brand': '#1F7A78',
  'Product': '#1E3332',
  'Templates': '#7E5C8E',
  'Content': '#B94B01'
};

const FILE_TYPE_MAP = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'PNG',
  'image/svg+xml': 'SVG',
  'application/zip': 'ZIP',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Slide',
  'application/vnd.google-apps.presentation': 'Slide',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOC',
  'application/vnd.google-apps.document': 'DOC',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Sheet',
  'application/vnd.google-apps.spreadsheet': 'Sheet',
  'video/mp4': 'Video',
  'video/quicktime': 'Video',
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Parse service account credentials from env
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const folderId = process.env.GOOGLE_FOLDER_ID;

    // Auth
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Get top-level category folders
    const categoriesRes = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });

    const categories = categoriesRes.data.files;
    const assets = [];
    let idCounter = 1;

    for (const category of categories) {
      // Get subcategory folders
      const subcatsRes = await drive.files.list({
        q: `'${category.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
      });

      const subcategories = subcatsRes.data.files;

      for (const subcat of subcategories) {
        // Get files in this subcategory
        const filesRes = await drive.files.list({
          q: `'${subcat.id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name, mimeType, createdTime, webViewLink)',
        });

        const files = filesRes.data.files;

        for (const file of files) {
          const fileType = FILE_TYPE_MAP[file.mimeType] || 'PDF';
          const thumbColor = THUMB_COLORS[category.name] || '#1F7A78';

          // Clean up filename for display (remove extension)
          const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').replace(/-/g, ' ');

          assets.push({
            id: String(idCounter++).padStart(3, '0'),
            name: cleanName,
            category: category.name,
            subcategory: subcat.name,
            description: `${cleanName} — ${subcat.name.toLowerCase()} asset.`,
            fileType,
            status: 'active',
            visibility: 'internal',
            owner: 'Marketing',
            dateAdded: file.createdTime ? file.createdTime.split('T')[0] : new Date().toISOString().split('T')[0],
            tags: [],
            keywords: cleanName.toLowerCase().split(' ').filter(w => w.length > 3),
            formats: [{ label: fileType, url: file.webViewLink }],
            thumbnail: `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`,
            thumbColor,
          });
        }
      }
    }

    res.status(200).json(assets);
  } catch (err) {
    console.error('Drive API error:', err);
    res.status(500).json({ error: err.message });
  }
}
