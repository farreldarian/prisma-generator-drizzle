import { createId } from '@paralleldrive/cuid2'
import { beforeEach, describe, expect, test } from 'bun:test'
import { Db, Schema } from 'src/lib/types'

export async function testImplicitRelation(db: Db, schema: Schema) {
  describe('implicit relation', () => {
    beforeEach(async () => {
      // @ts-expect-error
      await db.insert(schema.productDetailsToTransactionHeaders)
      await db.delete(schema.transactionHeaders)
      await db.delete(schema.productDetails)
    })

    // https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/many-to-many-relations#rules-for-defining-an-implicit-m-n-relation
    // https://orm.drizzle.team/docs/rqb#many-to-many
    test('generated m-n or join table', async () => {
      expect(schema).toHaveProperty('productDetailsToTransactionHeaders')

      const thead = { id: createId() }
      await db.insert(schema.transactionHeaders).values(thead)

      const product = { id: createId() }
      await db.insert(schema.productDetails).values(product)

      // @ts-expect-error
      await db.insert(schema.productDetailsToTransactionHeaders).values({
        A: product.id,
        B: thead.id,
      })

      const thead_result = await db.query.transactionHeaders.findFirst({
        where: (TransactionHeader, { eq }) =>
          eq(TransactionHeader.id, thead.id),
        with: { products: true },
      })
      expect(thead_result).toStrictEqual({
        ...thead,
        products: [product],
      })

      const product_result = await db.query.productDetails.findFirst({
        where: (ProductDetail, { eq }) => eq(ProductDetail.id, product.id),
        with: { transactions: true },
      })
      expect(product_result).toStrictEqual({
        ...product,
        transactions: [thead],
      })
    })
  })
}
