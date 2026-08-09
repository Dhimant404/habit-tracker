/* Vendor bundle entry — bundled to vendor.js by build.js (esbuild).
 *
 * These used to be fetched at runtime: React + framer-motion as ~196 separate ES modules
 * from esm.sh, plus supabase-js from unpkg. Every visitor paid that on every page load,
 * and boot() is gated on it, so the screen stayed blank until all of it landed. Bundling
 * locally makes it one same-origin, cacheable request.
 *
 * Everything still shares ONE React instance (the original reason for the import map). */
import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { createPortal } from 'react-dom';
import * as FramerMotion from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

window.React = React;
window.ReactDOM = ReactDOMClient;      // exposes createRoot
window.createPortal = createPortal;
window.FramerMotion = FramerMotion;
window.supabase = { createClient };
window.__framerReady = true;
window.dispatchEvent(new Event('framer-ready'));
