const router = require('express').Router();
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const pool = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { validateUuidParam } = require('../middleware/validateUuid');

router.param('id', validateUuidParam);

/** GET /api/reports?type=Match|Physique|Scouting|Médical|Tactique */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { type } = req.query;
  const params = []; let where = '';
  if (type) { params.push(type); where = 'WHERE type = $1'; }
  const { rows } = await pool.query(
    `SELECT r.*, u.full_name AS created_by_name FROM reports r LEFT JOIN users u ON u.id = r.created_by ${where} ORDER BY report_date DESC`,
    params
  );
  res.json({ reports: rows });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { title, type, report_date } = req.body;
  if (!title || !type) return res.status(400).json({ error: 'Le titre et le type du rapport sont requis.' });
  const { rows } = await pool.query(
    `INSERT INTO reports (title, type, report_date, created_by) VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4) RETURNING *`,
    [title, type, report_date, req.user.id]
  );
  res.status(201).json({ report: rows[0] });
}));

/**
 * GET /api/reports/:id/export?format=pdf|excel
 * Génère un fichier binaire réel (pdfkit / exceljs) à partir des champs réels
 * du rapport en base — pas de statistiques inventées : le contenu se limite
 * à ce que la table `reports` sait effectivement (titre, type, date, auteur).
 */
router.get('/:id/export', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, u.full_name AS created_by_name FROM reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Rapport introuvable.' });
  const report = rows[0];
  const format = req.query.format === 'excel' ? 'excel' : 'pdf';
  const safeTitle = report.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'rapport';

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CoachBoot Enterprise';
    const sheet = workbook.addWorksheet('Rapport');
    sheet.columns = [{ header: 'Champ', key: 'field', width: 24 }, { header: 'Valeur', key: 'value', width: 60 }];
    sheet.addRows([
      { field: 'Titre', value: report.title },
      { field: 'Type', value: report.type },
      { field: 'Date du rapport', value: new Date(report.report_date).toLocaleDateString('fr-FR') },
      { field: 'Auteur', value: report.created_by_name || 'Non renseigné' },
      { field: 'Créé le', value: new Date(report.created_at).toLocaleString('fr-FR') },
      { field: 'Exporté le', value: new Date().toLocaleString('fr-FR') },
    ]);
    sheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.pdf"`);
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).text('CoachBoot Enterprise', { align: 'left' });
  doc.fontSize(12).fillColor('#555').text('Rapport', { align: 'left' });
  doc.moveDown(1.5);
  doc.fillColor('#000').fontSize(16).text(report.title);
  doc.moveDown(1);
  doc.fontSize(11);
  doc.text(`Type : ${report.type}`);
  doc.text(`Date du rapport : ${new Date(report.report_date).toLocaleDateString('fr-FR')}`);
  doc.text(`Auteur : ${report.created_by_name || 'Non renseigné'}`);
  doc.text(`Créé le : ${new Date(report.created_at).toLocaleString('fr-FR')}`);
  doc.moveDown(1);
  doc.fontSize(9).fillColor('#888').text(`Exporté le ${new Date().toLocaleString('fr-FR')}`);
  doc.end();
}));

module.exports = router;
