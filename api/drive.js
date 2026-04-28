const { google } = require('googleapis');

const THUMB_COLORS = {
  'Brand': '#1F7A78',
  'Product': '#1E3332',
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

// Display name maps for tag tokens
const SEGMENT_NAMES = {
  'comm': 'Commercial',
  'pubsec': 'Public Sector',
  'partn': 'Partner',
  'allseg': null  // null = "applies to all", don't show as filter chip on card
};

const INDUSTRY_NAMES = {
  'agritech': 'Agritech',
  'defense': 'Defense',
  'healthcare': 'Healthcare',
  'hospitality': 'Hospitality',
  'logistics': 'Logistics',
  'manufacturing': 'Manufacturing',
  'publicsector': 'Public Sector',
  'retail': 'Retail',
  'techsoftware': 'Technology & Software',
  'telecom': 'Telecommunications',
  'allind': null
};

const USECASE_NAMES = {
  'vmsonk8s': 'VMs on K8s',
  'edgek8s': 'Edge K8s',
  'k8saas': 'K8s-as-a-Service',
  'baremetalk8s': 'Bare Metal K8s',
  'allusec': null
};

const PRODUCT_NAMES = {
  'palette': 'Palette',
  'paletteai': 'PaletteAI',
  'palettevertex': 'Palette VerteX',
  'paletteaivertex': 'PaletteAI VerteX',
  'allprod': null
};

// Parse filename: [clean-name]_[segment]_[industry]_[usecase]_[product].ext
function parseFilename(filename) {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  const parts = nameWithoutExt.split('_');
  
  // Need at least 5 parts (name + 4 tag slots)
  if (parts.length < 5) {
    return {
      cleanName: nameWithoutExt.replace(/-/g, ' '),
      segment: null,
      industry: null,
      usecase: null,
      product: null,
      followsConvention: false
    };
  }
  
  // Last 4 parts are the tag slots, everything before is the clean name
  const product = parts[parts.length - 1];
  const usecase = parts[parts.length - 2];
  const industry = parts[parts.length - 3];
  const segment = parts[parts.length - 4];
  const cleanNameParts = parts.slice(0, parts.length - 4);
  const cleanName = cleanNameParts.join('-').replace(/-/g, ' ');
  
  return {
    cleanName: cleanName.replace(/\b\w/g, c => c.toUpperCase()),
    segment: SEGMENT_NAMES[segment] !== undefined ? segment : null,
    industry: INDUSTRY_NAMES[industry] !== undefined ? industry : null,
    usecase: USECASE_NAMES[usecase] !== undefined ? usecase : null,
    product: PRODUCT_NAMES[product] !== undefined ? product : null,
    followsConvention: SEGMENT_NAMES[segment] !== undefined
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const folderId = process.env.GOOGLE_FOLDER_ID;

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
      const subcatsRes = await drive.files.list({
        q: `'${category.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
      });

      const subcategories = subcatsRes.data.files;

      for (const subcat of subcategories) {
        const filesRes = await drive.files.list({
          q: `'${subcat.id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name, mimeType, createdTime, webViewLink, thumbnailLink)',
        });

        const files = filesRes.data.files;

        for (const file of files) {
          const fileType = FILE_TYPE_MAP[file.mimeType] || 'PDF';
          const thumbColor = THUMB_COLORS[category.name] || '#1F7A78';
          
          // Parse the filename for tags
          const parsed = parseFilename(file.name);

          assets.push({
            id: String(idCounter++).padStart(3, '0'),
            name: parsed.cleanName,
            category: category.name,
            subcategory: subcat.name,
            description: `${parsed.cleanName} — ${subcat.name.toLowerCase()}.`,
            fileType,
            status: 'active',
            visibility: 'internal',
            owner: 'Marketing',
            dateAdded: file.createdTime ? file.createdTime.split('T')[0] : new Date().toISOString().split('T')[0],
            // Tag slots (raw tokens for filtering)
            segment: parsed.segment,
            industry: parsed.industry,
            usecase: parsed.usecase,
            product: parsed.product,
            // Display tags (only show non-"all" ones)
            tags: [
              SEGMENT_NAMES[parsed.segment],
              INDUSTRY_NAMES[parsed.industry],
              USECASE_NAMES[parsed.usecase],
              PRODUCT_NAMES[parsed.product]
            ].filter(Boolean),
            keywords: parsed.cleanName.toLowerCase().split(' ').filter(w => w.length > 2),
            formats: [{ label: fileType, url: file.webViewLink }],
            thumbnail: `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`,
            thumbnailDirect: file.thumbnailLink,
            thumbColor,
            followsConvention: parsed.followsConvention
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
