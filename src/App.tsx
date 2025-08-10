import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, ChevronLeft, Users, Wallet, ArrowRight, CheckCircle2, Trash2, Bug, Link as LinkIcon, Share2, UserPlus, LogIn, LogOut, Settings, ChevronDown } from "lucide-react";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "framer-motion";

/**
 * DriftWise (SplitKit) — Apple-clean bill splitter (web prototype)
 *
 * This single-file app supports:
 *  - Local-first groups/expenses with deterministic balances engine
 *  - Optional Supabase cloud sync (auth + realtime)
 *
 * This rewrite fixes a parser error from a truncated file and cleans up:
 *  - CloudGroupView useEffect now wraps async calls inside a function
 *  - Modal no longer follows cursor (removed drag), correct z-index
 *  - Segmented control animates horizontally with center-origin micro-scale
 *  - Dropdowns styled to match inputs (no gradients)
 */

// --- Font --------------------------------------------------------------------
const FontLoader: React.FC = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    :root{
      --bg: 245 245 247; /* iOS system gray 6-