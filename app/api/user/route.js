export async function GET(req, res) {
  const users = await prisma.users.findMany();
  return NextResponse.json(users);
}
export async function POST(req, res) {
  const { name, email, password } = await req.json();
  const user = await prisma.users.create({
    data: req.body,
  });
  return NextResponse.json(user);
}
