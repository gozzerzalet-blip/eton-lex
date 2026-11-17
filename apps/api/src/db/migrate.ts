import { migrate } from './index.js';
import { config } from '../config.js';

migrate();
console.log('Migración aplicada en', config.paths.db);
