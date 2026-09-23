import { useEffect, useRef } from "react";

// "Digital rain" backdrop for the call screen: columns of katakana, letters,
// digits and symbols falling with fading green trails, like The Matrix.
const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  "!@#$%^&*()-_=+[]{}<>/\\|;:'\",.?~`♥";

const FONT_SIZE = 16;
const FRAME_MS = 50; // ~20fps reads as rain and stays cheap next to live video
const TRAIL = "#00ff41";
const HEAD = "#d6ffdd";
// Deep purple backdrop — keep in sync with .call-view in styles.css.
const BG = "26, 6, 51";

const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

export default function MatrixRain() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let drops = [];
    let raf = 0;
    let last = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Each column starts at a random height above the screen so the
      // columns don't all fall in step.
      const rows = height / FONT_SIZE;
      drops = Array.from({ length: Math.ceil(width / FONT_SIZE) }, () => -Math.random() * rows);
      ctx.fillStyle = `rgb(${BG})`;
      ctx.fillRect(0, 0, width, height);
    }

    function step() {
      // Translucent backdrop over the last frame is what leaves the trails.
      ctx.fillStyle = `rgba(${BG}, 0.08)`;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${FONT_SIZE}px monospace`;
      for (let i = 0; i < drops.length; i++) {
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;
        // Repaint the previous head green so only the leading glyph glows.
        ctx.fillStyle = TRAIL;
        ctx.fillText(randomGlyph(), x, y - FONT_SIZE);
        ctx.fillStyle = HEAD;
        ctx.fillText(randomGlyph(), x, y);
        if (y > height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 1;
      }
    }

    function loop(t) {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      step();
    }

    function start() {
      cancelAnimationFrame(raf);
      resize();
      if (reduceMotion) {
        // Still frame: run the sim forward once instead of animating.
        for (let i = 0; i < 60; i++) step();
      } else {
        raf = requestAnimationFrame(loop);
      }
    }

    start();
    const ro = new ResizeObserver(start);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden="true" />;
}
