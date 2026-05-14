import Link from "next/link";
import { POSTS } from "@/lib/posts";

export default function PostsIndex() {
  return (
    <main>
      <h1>Posts</h1>
      <ul>
        {POSTS.map((p) => (
          <li key={p.slug}>
            <Link href={`/posts/${p.slug}`}>{p.title}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
