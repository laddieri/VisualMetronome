// p5.js global-mode API used by the app modules (p5 0.7.3 attaches these to
// window). Add names here when a module starts using another p5 function.
const names = `
  BOLD CENTER CLOSE CORNER HALF_PI NORMAL PI TWO_PI
  arc background beginShape bezierVertex blue color constrain cos createCanvas
  drawingContext ellipse endShape fill green image imageMode lerpColor line
  loadImage map noFill noStroke pop push quadraticVertex rect rectMode red
  resizeCanvas rotate scale sin stroke strokeWeight text textAlign textFont
  textSize textStyle textWidth translate triangle vertex
`.trim().split(/\s+/);

export const p5Globals = Object.fromEntries(names.map((n) => [n, 'readonly']));
