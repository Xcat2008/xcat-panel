import express from 'express';

const router = express.Router();

router.get('/workshop/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();

    if (!/^\d{8,}$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'Workshop ID inválido.' });
    }

    const body = new URLSearchParams({
      itemcount: '1',
      'publishedfileids[0]': id
    });

    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      body
    });

    const data = await response.json();
    const item = data?.response?.publishedfiledetails?.[0];

    return res.json({
      ok: true,
      id,
      title: item?.title || `Workshop ${id}`,
      description: item?.file_description || '',
      previewUrl: item?.preview_url || '',
      creator: item?.creator || ''
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao obter dados do Workshop.'
    });
  }
});

export default router;
