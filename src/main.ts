// Entry point. Fonts first (canvas text waits for them in boot), then the app.
import './styles/fonts.css';
import { boot } from './app/boot';

boot().catch((err: unknown) => {
  console.error('SCALE failed to start:', err);
});
