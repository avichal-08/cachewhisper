export default function Home() {
  return (
    <div className="wrap narrow">
      <h1>cachewhisper</h1>
      <p className="sub">two processes pass a secret through a shared LLM prompt cache. hit = 1, miss = 0.</p>
      <div className="links">
        <a href="/alice">alice · sender</a>
        <a href="/bob">bob · receiver</a>
      </div>
    </div>
  );
}
