import { createServer } from 'node:http';
import { createSchema, createYoga, Repeater } from 'graphql-yoga';

type Post = { id: string; title: string; body: string; userId: string };

const posts: Post[] = [
  { id: '1', title: 'First Post', body: 'Hello from the mock server!', userId: '1' },
  { id: '2', title: 'Second Post', body: 'GraphQL is great for testing.', userId: '1' },
  { id: '3', title: 'Third Post', body: 'Subscriptions work over SSE.', userId: '2' },
];

const postSubscribers = new Set<(post: Post) => void>();

const yoga = createYoga({
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type Post {
        id: ID!
        title: String!
        body: String!
        userId: ID!
      }

      type Query {
        posts: [Post!]!
        post(id: ID!): Post
      }

      type Mutation {
        createPost(title: String!, body: String!, userId: ID!): Post!
        updatePost(id: ID!, title: String, body: String): Post
        deletePost(id: ID!): Boolean!
      }

      type Subscription {
        postCreated: Post!
      }
    `,
    resolvers: {
      Query: {
        posts: () => posts,
        post: (_: unknown, { id }: { id: string }) =>
          posts.find((p) => p.id === id) ?? null,
      },
      Mutation: {
        createPost: (
          _: unknown,
          { title, body, userId }: { title: string; body: string; userId: string }
        ) => {
          const post: Post = {
            id: String(posts.length + 1),
            title,
            body,
            userId,
          };
          posts.push(post);
          postSubscribers.forEach((fn) => fn(post));
          return post;
        },
        updatePost: (
          _: unknown,
          { id, title, body }: { id: string; title?: string; body?: string }
        ) => {
          const post = posts.find((p) => p.id === id);
          if (!post) return null;
          if (title != null) post.title = title;
          if (body != null) post.body = body;
          return post;
        },
        deletePost: (_: unknown, { id }: { id: string }) => {
          const index = posts.findIndex((p) => p.id === id);
          if (index === -1) return false;
          posts.splice(index, 1);
          return true;
        },
      },
      Subscription: {
        postCreated: {
          subscribe: () =>
            new Repeater<Post>(async (push, stop) => {
              const fn = (post: Post) => push(post);
              postSubscribers.add(fn);
              await stop;
              postSubscribers.delete(fn);
            }),
          resolve: (post: Post) => post,
        },
      },
    },
  }),
  graphqlEndpoint: '/graphql',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  logging: true,
});

const server = createServer(yoga);
const PORT = 4000;

server.listen(PORT, () => {
  console.log(`Mock GraphQL server running at http://localhost:${PORT}/graphql`);
});
