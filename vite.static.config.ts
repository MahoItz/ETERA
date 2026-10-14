import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'static',publicDir:'../public',plugins:[react()],define:{'process.env.NEXT_PUBLIC_CATALOG_STATIC':JSON.stringify('true')},build:{outDir:'../static-dist',emptyOutDir:true}});
