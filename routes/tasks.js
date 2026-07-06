const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/tasks/:task_id
router.get('/:task_id', async (req, res) => {
  try {
    const task = await db.getAiTask(req.params.task_id, req.userId);
    if (!task) return res.status(404).json({ code: 404, message: '任务不存在', data: null });

    res.json({
      code: 200,
      message: 'success',
      data: {
        task_id: task.task_id,
        task_type: task.task_type,
        status: task.status,
        progress: task.progress,
        result: task.result,
        error_message: task.error_message,
        created_at: task.created_at,
        completed_at: task.completed_at
      }
    });
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
