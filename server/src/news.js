import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const newsSchema = z.object({
  title: z.string().trim().min(5).max(120),
  excerpt: z.string().trim().min(10).max(240),
  body: z.string().trim().min(20).max(12000),
  imageUrl: z.string().trim().max(500).refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'La imagen debe utilizar una URL HTTPS válida.'),
  status: z.enum(['draft', 'published']),
});

export class NewsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function slugify(title) {
  return title.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'noticia';
}

function parseInput(rawInput) {
  const parsed = newsSchema.safeParse(rawInput);
  if (!parsed.success) throw new NewsError(400, 'Revisa el título, el resumen, el texto y la imagen.');
  return parsed.data;
}

function uniqueSlug(database, title) {
  const slug = slugify(title);
  const existing = database.prepare('SELECT 1 FROM news_posts WHERE slug = ?').get(slug);
  return existing ? `${slug}-${randomBytes(3).toString('hex')}` : slug;
}

export function listPublishedNews(database) {
  return database.prepare(`
    SELECT slug, title, excerpt, body, image_url AS imageUrl, published_at AS publishedAt
    FROM news_posts
    WHERE status = 'published'
    ORDER BY published_at DESC, id DESC
    LIMIT 6
  `).all();
}

export function listNewsForStaff(database) {
  return database.prepare(`
    SELECT news_posts.id, news_posts.slug, news_posts.title, news_posts.excerpt,
      news_posts.body, news_posts.image_url AS imageUrl, news_posts.status,
      news_posts.created_at AS createdAt, news_posts.updated_at AS updatedAt,
      staff_users.username AS author
    FROM news_posts
    JOIN staff_users ON staff_users.id = news_posts.created_by
    ORDER BY news_posts.updated_at DESC, news_posts.id DESC
  `).all();
}

export function createNews(database, authorId, rawInput) {
  const input = parseInput(rawInput);
  const slug = uniqueSlug(database, input.title);
  const result = database.prepare(`
    INSERT INTO news_posts (slug, title, excerpt, body, image_url, status, created_by, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END)
  `).run(slug, input.title, input.excerpt, input.body, input.imageUrl, input.status, authorId, input.status);

  return database.prepare(`
    SELECT id, slug, title, excerpt, body, image_url AS imageUrl, status,
      created_at AS createdAt, published_at AS publishedAt
    FROM news_posts WHERE id = ?
  `).get(result.lastInsertRowid);
}

export function updateNews(database, id, rawInput) {
  const input = parseInput(rawInput);
  const existing = database.prepare('SELECT id, published_at AS publishedAt FROM news_posts WHERE id = ?').get(id);
  if (!existing) throw new NewsError(404, 'No encontramos esa noticia.');

  const slug = slugify(input.title);
  const conflict = database.prepare('SELECT id FROM news_posts WHERE slug = ? AND id != ?').get(slug, id);
  const safeSlug = conflict ? `${slug}-${randomBytes(3).toString('hex')}` : slug;
  database.prepare(`
    UPDATE news_posts
    SET slug = ?, title = ?, excerpt = ?, body = ?, image_url = ?, status = ?,
      updated_at = CURRENT_TIMESTAMP,
      published_at = CASE
        WHEN ? = 'draft' THEN NULL
        ELSE COALESCE(published_at, CURRENT_TIMESTAMP)
      END
    WHERE id = ?
  `).run(safeSlug, input.title, input.excerpt, input.body, input.imageUrl, input.status, input.status, id);

  return database.prepare(`
    SELECT id, slug, title, excerpt, body, image_url AS imageUrl, status,
      created_at AS createdAt, published_at AS publishedAt
    FROM news_posts WHERE id = ?
  `).get(id);
}

export function deleteNews(database, id) {
  const result = database.prepare('DELETE FROM news_posts WHERE id = ?').run(id);
  if (!result.changes) throw new NewsError(404, 'No encontramos esa noticia.');
  return { id };
}
