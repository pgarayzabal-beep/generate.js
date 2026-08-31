// api/generate.js
// Backend externo — recibe la foto + opciones desde la página de Shopify,
// quita el fondo con remove.bg, compone el retrato final (fondo blanco,
// blanco y negro u color, nombre superpuesto) y lo devuelve.
//
// Variables de entorno necesarias (configúralas en Vercel > Settings > Environment Variables):
//   REMOVE_BG_API_KEY  → tu clave de https://www.remove.bg/api

const sharp = require('sharp');

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 1250;

module.exports = async function handler(req, res) {
  // Permite llamadas desde tu dominio de Shopify (ajusta "*" por tu dominio real en producción)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { imageBase64, name, style } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Falta la imagen (imageBase64)' });
    }
    if (!process.env.REMOVE_BG_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar REMOVE_BG_API_KEY en el servidor' });
    }

    // 1. Quitar el fondo con remove.bg
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    const removeBgResponse = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': process.env.REMOVE_BG_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_file_b64: base64Data,
        size: 'auto'
      })
    });

    if (!removeBgResponse.ok) {
      const errText = await removeBgResponse.text();
      console.error('remove.bg error:', errText);
      return res.status(502).json({ error: 'No se pudo quitar el fondo de la imagen' });
    }

    const cutoutBuffer = Buffer.from(await removeBgResponse.arrayBuffer());

    // 2. Redimensionar el recorte para que quepa en el lienzo, dejando margen inferior
    const targetWidth = Math.round(CANVAS_WIDTH * 0.72);
    let cutout = sharp(cutoutBuffer).resize({ width: targetWidth, withoutEnlargement: true });

    if (style === 'bw') {
      cutout = cutout.grayscale();
    }

    const cutoutBufferResized = await cutout.png().toBuffer();
    const cutoutMeta = await sharp(cutoutBufferResized).metadata();

    // 3. Crear el lienzo blanco base
    const canvas = sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    });

    // 4. Posicionar la mascota "asomando" desde abajo, centrada
    const left = Math.round((CANVAS_WIDTH - cutoutMeta.width) / 2);
    const top = CANVAS_HEIGHT - cutoutMeta.height - 60; // 60px de margen inferior

    const composites = [
      { input: cutoutBufferResized, left: left, top: Math.max(top, 0) }
    ];

    // 5. Nombre superpuesto (tipografía fina, mayúsculas, letter-spacing amplio) via SVG
    if (name && name.trim().length > 0) {
      const displayName = name.trim().toUpperCase();
      const svgText = `
        <svg width="${CANVAS_WIDTH}" height="200">
          <text x="50%" y="110" text-anchor="middle"
            font-family="Georgia, serif" font-weight="300" font-size="46"
            letter-spacing="10" fill="#2A2420">${escapeXml(displayName)}</text>
        </svg>`;
      composites.push({ input: Buffer.from(svgText), left: 0, top: 40 });
    }

    const finalBuffer = await canvas.composite(composites).png().toBuffer();
    const finalBase64 = 'data:image/png;base64,' + finalBuffer.toString('base64');

    return res.status(200).json({ imageBase64: finalBase64 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno generando el retrato' });
  }
};

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c];
  });
}
