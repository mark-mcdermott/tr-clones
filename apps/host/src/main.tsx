import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BoombapbotEditor } from '@boombapbot/editor';
import { machine } from '@tr-clones/machine-808';
import './styles.css';

const root = document.getElementById('machine');
if (!root) throw new Error('the page has no place for the machine');

createRoot(root).render(
  <StrictMode>
    <BoombapbotEditor machine={machine} baseUrl={import.meta.env.BASE_URL} />
  </StrictMode>,
);
