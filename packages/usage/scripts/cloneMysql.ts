export type {}

const BASE_PATH = './prisma/schema.prisma'
const TARGET_PATH = './prisma/mysql/schema.prisma'

const schema = (await Bun.file(BASE_PATH).text())
	.replace('postgresql', 'mysql')
	.replace('VITE_PG_DATABASE_URL', 'VITE_MYSQL_DATABASE_URL')
	.replace(/(\/\/ start -mysql\n)[\s\S]*?(\n\/\/ end -mysql)/g, '')
	.replace(/^.*-mysql.*/gm, '')

Bun.write(TARGET_PATH, schema)
