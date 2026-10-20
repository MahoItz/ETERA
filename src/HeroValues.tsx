import { Flower2, Gift, Heart } from "lucide-react";
import "./hero-values.css";

export function HeroValues() {
  return <div className="winter-values">
    <div><Flower2 /><span>РУЧНАЯ РАБОТА<small>С ЛЮБОВЬЮ</small></span></div>
    <div><Gift /><span>МАЛЕНЬКИЕ РАДОСТИ<small>БОЛЬШИЕ ЧУВСТВА</small></span></div>
    <div><Heart /><span>ДЛЯ ВАШЕГО ДОМА<small>И ОСОБЫХ МОМЕНТОВ</small></span></div>
  </div>;
}
