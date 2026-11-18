import { Router } from 'express';
import { z } from 'zod';
import { db, tx, uuid } from '../../db/index.js';
import { requireAuth } from '../../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../../lib/http.js';
import { buildTutorQuestions, isCorrect, publicQuestion, revealQuestion, } from './tutor.js';
export const tutorRouter = Router();
tutorRouter.use(requireAuth);
const createSchema = z.object({
    area: z.string().trim().max(60).optional().default(''),
    topic: z.string().trim().max(160).optional().default(''),
    documentId: z.string().uuid().nullable().optional(),
    questionCount: z.number().int().min(3).max(10).optional().default(5),
});
const answerSchema = z.object({
    questionId: z.string().uuid(),
    answerIndex: z.number().int().min(0).max(3),
});
function parseJson(value, fallback) {
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function rowToQuestion(row) {
    return {
        id: row.id,
        position: row.position,
        prompt: row.prompt,
        options: parseJson(row.options_json, []),
        correctIndex: row.correct_index,
        explanation: row.explanation,
        citations: parseJson(row.citations_json, []),
        sourceLabel: row.source_label,
        sourceText: row.source_text,
        sourceUrl: row.source_url,
    };
}
function summary(sessionId) {
    const row = db.prepare(`
    SELECT COUNT(q.id) AS total,
           COUNT(a.id) AS answered,
           COALESCE(SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END), 0) AS correct
    FROM tutor_questions q
    LEFT JOIN tutor_attempts a ON a.question_id = q.id AND a.session_id = q.session_id
    WHERE q.session_id = ?
  `).get(sessionId);
    return {
        total: row.total,
        answered: row.answered,
        correct: row.correct,
        score: row.total ? Math.round((row.correct / row.total) * 100) : 0,
        completed: row.total > 0 && row.answered === row.total,
    };
}
function ownedSession(userId, sessionId) {
    const session = db.prepare('SELECT * FROM tutor_sessions WHERE id = ? AND user_id = ?')
        .get(sessionId, userId);
    if (!session)
        throw notFound('Sesión de tutor no encontrada.');
    return session;
}
function nextQuestion(sessionId) {
    const row = db.prepare(`
    SELECT q.* FROM tutor_questions q
    LEFT JOIN tutor_attempts a ON a.question_id = q.id AND a.session_id = q.session_id
    WHERE q.session_id = ? AND a.id IS NULL
    ORDER BY q.position LIMIT 1
  `).get(sessionId);
    return row ? rowToQuestion(row) : null;
}
function sessionView(session) {
    const next = nextQuestion(session.id);
    return {
        session: {
            id: session.id,
            area: session.area,
            topic: session.topic,
            documentId: session.document_id,
            questionCount: session.question_count,
            status: session.status,
            createdAt: session.created_at,
            completedAt: session.completed_at,
        },
        progress: summary(session.id),
        next: next ? publicQuestion(next) : null,
    };
}
tutorRouter.get('/areas', asyncHandler(async (_req, res) => {
    const areas = db.prepare('SELECT slug, name, description FROM legal_areas ORDER BY name').all();
    res.json({ areas });
}));
tutorRouter.post('/sessions', asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body ?? {});
    const userId = req.user.id;
    if (data.area && !db.prepare('SELECT 1 FROM legal_areas WHERE slug = ?').get(data.area)) {
        throw badRequest('El área elegida no existe en la biblioteca.');
    }
    if (data.documentId && !db.prepare('SELECT 1 FROM ai_documents WHERE id = ? AND user_id = ?').get(data.documentId, userId)) {
        throw notFound('Documento no encontrado.');
    }
    const generated = await buildTutorQuestions({
        userId,
        area: data.area,
        topic: data.topic,
        documentId: data.documentId ?? null,
        count: data.questionCount,
    });
    if (generated.length === 0) {
        throw badRequest('No hay suficiente texto verificable para preparar preguntas. Prueba con otro tema, área o documento.');
    }
    const id = uuid();
    tx(() => {
        db.prepare(`
      INSERT INTO tutor_sessions (id, user_id, area, topic, document_id, question_count, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(id, userId, data.area || null, data.topic || null, data.documentId ?? null, generated.length);
        const insert = db.prepare(`
      INSERT INTO tutor_questions (id, session_id, position, prompt, options_json, correct_index,
        explanation, citations_json, source_text, source_label, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        generated.forEach((question, index) => {
            insert.run(uuid(), id, index + 1, question.prompt, JSON.stringify(question.options), question.correctIndex, question.explanation, JSON.stringify(question.citations), question.sourceText, question.sourceLabel, question.sourceUrl);
        });
    });
    res.status(201).json(sessionView(ownedSession(userId, id)));
}));
tutorRouter.get('/sessions', asyncHandler(async (req, res) => {
    const rows = db.prepare(`
    SELECT s.*, COUNT(q.id) AS total, COUNT(a.id) AS answered,
           COALESCE(SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END), 0) AS correct
    FROM tutor_sessions s
    LEFT JOIN tutor_questions q ON q.session_id = s.id
    LEFT JOIN tutor_attempts a ON a.session_id = s.id AND a.question_id = q.id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC LIMIT 50
  `).all(req.user.id);
    res.json({
        sessions: rows.map((s) => ({
            id: s.id,
            area: s.area,
            topic: s.topic,
            status: s.status,
            createdAt: s.created_at,
            total: s.total,
            answered: s.answered,
            correct: s.correct,
            score: s.total ? Math.round((s.correct / s.total) * 100) : 0,
        })),
    });
}));
tutorRouter.get('/sessions/:id', asyncHandler(async (req, res) => {
    res.json(sessionView(ownedSession(req.user.id, req.params.id)));
}));
tutorRouter.post('/sessions/:id/answers', asyncHandler(async (req, res) => {
    const data = answerSchema.parse(req.body);
    const userId = req.user.id;
    const session = ownedSession(userId, req.params.id);
    if (session.status === 'completed')
        throw conflict('Esta sesión ya terminó.');
    const row = db.prepare('SELECT * FROM tutor_questions WHERE id = ? AND session_id = ?')
        .get(data.questionId, session.id);
    if (!row)
        throw notFound('Pregunta no encontrada en esta sesión.');
    if (db.prepare('SELECT 1 FROM tutor_attempts WHERE session_id = ? AND question_id = ?').get(session.id, data.questionId)) {
        throw conflict('Esta pregunta ya fue respondida.');
    }
    const question = rowToQuestion(row);
    const correct = isCorrect(question, data.answerIndex);
    const feedback = correct
        ? `Correcto. ${question.explanation}`
        : `Todavía no. La respuesta correcta es la opción ${question.correctIndex + 1}. ${question.explanation}`;
    tx(() => {
        db.prepare(`
      INSERT INTO tutor_attempts (id, session_id, question_id, user_id, answer_index, correct, feedback)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), session.id, question.id, userId, data.answerIndex, correct ? 1 : 0, feedback);
        const progress = summary(session.id);
        if (progress.completed) {
            db.prepare("UPDATE tutor_sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?")
                .run(session.id);
        }
    });
    res.json({
        correct,
        answerIndex: data.answerIndex,
        correctIndex: question.correctIndex,
        feedback,
        citations: question.citations,
        progress: summary(session.id),
        next: (() => {
            const n = nextQuestion(session.id);
            return n ? publicQuestion(n) : null;
        })(),
    });
}));
tutorRouter.get('/sessions/:id/result', asyncHandler(async (req, res) => {
    const session = ownedSession(req.user.id, req.params.id);
    const rows = db.prepare(`
    SELECT q.*, a.answer_index AS answerIndex, a.correct AS wasCorrect, a.feedback
    FROM tutor_questions q
    LEFT JOIN tutor_attempts a ON a.question_id = q.id AND a.session_id = q.session_id
    WHERE q.session_id = ? ORDER BY q.position
  `).all(session.id);
    res.json({
        ...sessionView(session),
        questions: rows.map((row) => ({
            ...revealQuestion(rowToQuestion(row)),
            answerIndex: row.answerIndex ?? null,
            wasCorrect: row.wasCorrect === null ? null : row.wasCorrect === 1,
            feedback: row.feedback ?? null,
        })),
    });
}));
tutorRouter.delete('/sessions/:id', asyncHandler(async (req, res) => {
    const session = ownedSession(req.user.id, req.params.id);
    db.prepare('DELETE FROM tutor_sessions WHERE id = ?').run(session.id);
    res.json({ ok: true });
}));
//# sourceMappingURL=tutor.routes.js.map