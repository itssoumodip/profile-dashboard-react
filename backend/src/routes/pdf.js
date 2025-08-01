import express from 'express';
import PDFDocument from 'pdfkit';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.post('/generate-pdf', async (req, res) => {
  console.log('PDF generation request received:', req.body);
  
  try {
    const { userId, userData } = req.body;
    
    if (!userId || !userData) {
      console.log('Missing userId or userData');
      return res.status(400).json({ error: 'Missing required data' });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Create PDFs directory if not present
    const pdfDir = path.join(__dirname, '../../pdfs');
    console.log('PDF directory path:', pdfDir);
    await fs.ensureDir(pdfDir);

    // Create a PDF document
    const doc = new PDFDocument({ margin: 50 });
    const pdfFilename = `profile-${userId.slice(-8)}-${Date.now()}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    console.log('Creating PDF at:', pdfPath);
    
    // Download and embed profile image synchronously if available
    let tempImagePath = null;
    if (userData.profileImage && userData.profileImage.startsWith('http')) {
      try {
        const axios = await import('axios');
        const os = await import('os');
        const tempDir = os.default.tmpdir();
        tempImagePath = path.join(tempDir, `profile-image-${Date.now()}.jpg`);
        const response = await axios.default.get(userData.profileImage, { responseType: 'arraybuffer' });
        await fs.writeFile(tempImagePath, response.data);
      } catch (imageError) {
        console.log('Could not load profile image:', imageError);
        tempImagePath = null;
      }
    }

    // Generate PDF in memory
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', async () => {
      const pdfBuffer = Buffer.concat(chunks);
      // Clean up temp image file
      if (tempImagePath) {
        try { await fs.unlink(tempImagePath); } catch (e) { /* ignore */ }
      }
      // Save PDF buffer to user
      try {
        const filename = `profile-${userId.slice(-8)}-${Date.now()}.pdf`;
        user.pdfs.push({
          filename,
          data: pdfBuffer,
          contentType: 'application/pdf',
          generatedAt: new Date()
        });
        await user.save();
        console.log('PDF buffer saved to user successfully');
        res.json({ success: true, filename });
      } catch (saveError) {
        console.error('Error saving PDF buffer to user:', saveError);
        res.status(500).json({ error: 'Error saving PDF to database' });
      }
    });

    // Title
    doc.fontSize(24)
       .text('PROFILE INFORMATION PDF', { align: 'center', style: 'bold' , bold: true})
       .moveDown(1.5);

    // Name
    doc.fontSize(16)
       .text(`Name: ${userData.firstName} ${userData.lastName}`, { align: 'left' })
       .moveDown(1);

    // Profile Image label
    doc.fontSize(14)
       .text('Profile Image:', { underline: true })
       .moveDown(0.5);

    // Embed image if downloaded
    if (tempImagePath) {
      try {
        doc.image(tempImagePath, {
          fit: [200, 200],
          align: 'left'
        });
        doc.moveDown(1.5);
      } catch (err) {
        console.log('Error embedding image:', err);
      }
    }

    // User Details
    doc.fontSize(14)
       .text('Contact Information:', { underline: true })
       .moveDown(0.5);
    doc.fontSize(12)
       .text(`Email: ${userData.email || 'Not provided'}`)
       .moveDown(0.3);
    if (userData.phone && userData.phone !== 'Not provided') {
      doc.text(`Phone: ${userData.phone}`)
         .moveDown(0.3);
    }
    if (userData.location && userData.location !== 'Not provided') {
      doc.text(`Location: ${userData.location}`)
         .moveDown(0.3);
    }
    doc.moveDown();
    if (userData.bio && userData.bio !== 'No bio available') {
      doc.fontSize(14)
         .text('Bio:', { underline: true })
         .moveDown(0.5);
      doc.fontSize(12)
         .text(userData.bio, { width: 500, align: 'justify' })
         .moveDown();
    }

    // Footer
    doc.moveDown(2)
       .fontSize(10)
       .text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Route to download/serve PDF files from MongoDB
router.get('/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    // Find the user who has this PDF
    const user = await User.findOne({ 'pdfs.filename': filename }, { 'pdfs.$': 1 });
    if (!user || !user.pdfs || user.pdfs.length === 0) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    const pdf = user.pdfs[0];
    if (!pdf.data) {
      return res.status(404).json({ error: 'PDF data not found' });
    }
    res.setHeader('Content-Type', pdf.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.send(pdf.data);
  } catch (error) {
    console.error('Error serving PDF from MongoDB:', error);
    res.status(500).json({ error: 'Error serving PDF file' });
  }
});

// Route to get user's PDFs
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('pdfs');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ pdfs: user.pdfs || [] });
  } catch (error) {
    console.error('Error fetching user PDFs:', error);
    res.status(500).json({ error: 'Error fetching PDFs' });
  }
});

// Test route to verify PDF generation works
router.get('/test', async (req, res) => {
  try {
    const pdfDir = path.join(__dirname, '../../pdfs');
    await fs.ensureDir(pdfDir);
    
    const doc = new PDFDocument();
    const testFilename = `test-${Date.now()}.pdf`;
    const testPath = path.join(pdfDir, testFilename);
    
    const pdfStream = fs.createWriteStream(testPath);
    doc.pipe(pdfStream);
    
    doc.fontSize(20)
       .text('Test PDF Generation', { align: 'center' })
       .moveDown()
       .fontSize(12)
       .text('This is a test PDF to verify the generation is working.');
    
    doc.end();
    
    pdfStream.on('finish', () => {
      res.json({ 
        success: true, 
        message: 'Test PDF generated successfully',
        path: `/api/pdf/download/${testFilename}`,
        filename: testFilename
      });
    });
    
    pdfStream.on('error', (error) => {
      console.error('Test PDF error:', error);
      res.status(500).json({ error: 'Test PDF generation failed' });
    });
    
  } catch (error) {
    console.error('Test route error:', error);
    res.status(500).json({ error: 'Test route failed: ' + error.message });
  }
});

export default router;

