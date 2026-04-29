import { Router } from 'express';
import {
  listLibraryItems,
  buildMinecraftPaperLibrary,
  buildCs2Library
} from '../services/libraryService.js';

const router = Router();

/**
 * LISTAR LIBRARY
 */
router.get('/', async (req, res) => {
  try {
    const items = await listLibraryItems();

    res.json({
      ok: true,
      items
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * BUILD MINECRAFT PAPER
 */
router.post('/minecraft-java/paper', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'Só o admin pode construir a Game Library'
      });
    }

    const item = await buildMinecraftPaperLibrary({
      minecraftVersion: req.body?.minecraftVersion || null
    });

    res.status(201).json({
      ok: true,
      item
    });

  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * BUILD CS2 (STEAMCMD)
 */
router.post('/cs2', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'Só o admin pode construir a Game Library'
      });
    }

    const item = await buildCs2Library();

    res.status(201).json({
      ok: true,
      item
    });

  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
